// Teams and round-robin against the dev Postgres. Creates its own users, team and event type, and removes them.
// Run with: npm run test:int
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { sql } from "@/db/client";
import { BookingError, createBooking, getSlots } from "@/lib/booking/service";
import { sha256 } from "@/lib/crypto";
import { boss } from "@/lib/jobs/queue";
import { acceptInvite, createTeam, removeMember, TeamError } from "./index";
import { fixtures, type User } from "./test-fixtures";

const { run, makeUser, cleanup } = fixtures("rr");
const slug = `team-${run}`;
let owner: User, alice: User, bob: User, eventTypeId: string;

const book = (start: string, i: number) =>
  createBooking({ handle: slug, slug: "demo", start, inviteeName: `Invitee ${i}`, inviteeEmail: `inv${i}@example.test`, inviteeTimeZone: "UTC" });

beforeAll(async () => {
  [owner, alice, bob] = await Promise.all([makeUser("owner"), makeUser("alice"), makeUser("bob")]);
  const team = await createTeam(owner, "RR Test", slug);
  await sql`INSERT INTO team_members (team_id, user_id) VALUES (${team.id}, ${alice.id}), (${team.id}, ${bob.id})`;
  const [e] = await sql`
    INSERT INTO event_types (user_id, team_id, scheduling, slug, title, duration_minutes, minimum_notice_minutes)
    VALUES (${owner.id}, ${team.id}, 'round_robin', 'demo', 'Demo', 30, 0) RETURNING id`;
  eventTypeId = e.id;
  await sql`INSERT INTO event_type_hosts (event_type_id, user_id) VALUES (${eventTypeId}, ${alice.id}), (${eventTypeId}, ${bob.id})`;
});

afterAll(async () => {
  await cleanup();
  await (await boss()).stop({ graceful: false });
  await sql.end();
});

const window = () => {
  const from = DateTime.utc().plus({ days: 20 }).startOf("day");
  return [from.toISO()!, from.plus({ days: 1 }).toISO()!] as const;
};

describe("teams and round-robin", () => {
  it("team links share the username namespace", async () => {
    await expect(createTeam(alice, "Clash", "at20")).rejects.toMatchObject({ code: "TAKEN" });
    await expect(createTeam(alice, "Clash", slug)).rejects.toBeInstanceOf(TeamError);
    await expect(sql`INSERT INTO users (email, name, username, time_zone) VALUES ('clash@example.test', 'x', ${slug}, 'UTC')`).rejects.toMatchObject({
      code: "23505",
    });
  });

  it("a slot stays open until every host is booked, and concurrent requests fill one host each", async () => {
    const [from, to] = window();
    const slots = await getSlots(slug, "demo", from, to);
    expect(slots.length).toBe(48); // two identical 24h schedules merge into one set of 30-minute slots
    const target = slots[10].start;

    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => book(target, i)));
    const ok = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof book>>>).value);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(2);
    expect(new Set(ok.map((r) => r.host.id))).toEqual(new Set([alice.id, bob.id]));
    expect(rejected.every((r) => r.reason instanceof BookingError && r.reason.code === "SLOT_UNAVAILABLE")).toBe(true);

    const after = await getSlots(slug, "demo", from, to);
    expect(after.some((s) => s.start === target)).toBe(false);
  });

  it("distributes bookings evenly and skips a host who is busy", async () => {
    const [from, to] = window();
    const slots = await getSlots(slug, "demo", from, to);
    for (const [i, s] of slots.slice(20, 26).entries()) await book(s.start, 100 + i);
    const counts = await sql`SELECT host_id, count(*)::int AS n FROM bookings WHERE event_type_id = ${eventTypeId} GROUP BY host_id`;
    expect(counts.map((c) => c.n)).toEqual([4, 4]); // 1 + 3 each

    // Alice has a personal meeting at the next slot: it must go to Bob even though the load is equal.
    const busy = slots[30];
    const [personal] = await sql`SELECT id FROM event_types WHERE user_id = ${owner.id} LIMIT 1`;
    await sql`
      INSERT INTO bookings (event_type_id, host_id, ical_uid, start_at, end_at, invitee_name, invitee_email, invitee_time_zone, manage_token_hash)
      VALUES (${personal?.id ?? eventTypeId}, ${alice.id}, ${crypto.randomUUID()}, ${busy.start}, ${busy.end}, 'x', 'x@example.test', 'UTC', 'x')`;
    const r = await book(busy.start, 200);
    expect(r.host.id).toBe(bob.id);
  });

  it("invites are accepted only by the invited address, and removing a member drops them as a host", async () => {
    const [team] = await sql`SELECT * FROM teams WHERE slug = ${slug}`;
    const token = `test-invite-token-${run}-xxxxxxxx`;
    const carol = await makeUser("carol");
    await sql`INSERT INTO team_invites (team_id, email, token_hash, expires_at) VALUES (${team.id}, ${carol.email}, ${sha256(token)}, now() + interval '1 day')`;
    await expect(acceptInvite(token, alice)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await acceptInvite(token, carol);
    await expect(acceptInvite(token, carol)).rejects.toMatchObject({ code: "NOT_FOUND" }); // single use
    const [m] = await sql`SELECT role FROM team_members WHERE team_id = ${team.id} AND user_id = ${carol.id}`;
    expect(m.role).toBe("member");

    const teamRow = { id: team.id, ownerId: team.owner_id, slug: team.slug, name: team.name, createdAt: team.created_at };
    await removeMember(teamRow, bob.id);
    const hosts = await sql`SELECT user_id FROM event_type_hosts WHERE event_type_id = ${eventTypeId}`;
    expect(hosts.map((h) => h.user_id)).toEqual([alice.id]);
    await expect(removeMember(teamRow, owner.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
