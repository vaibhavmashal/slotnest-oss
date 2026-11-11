// Collective event types against the dev Postgres: every host joins, only shared free times are offered.
// Run with: npm run test:int
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { sql } from "@/db/client";
import { BookingError, cancelBooking, createBooking, getSlots, rescheduleBooking } from "@/lib/booking/service";
import { boss } from "@/lib/jobs/queue";
import { createTeam } from "./index";
import { fixtures, type User } from "./test-fixtures";

const { run, makeUser, cleanup } = fixtures("co");
const slug = `team-${run}`;
let owner: User, alice: User, bob: User;

const book = (start: string, i: number) =>
  createBooking({ handle: slug, slug: "all", start, inviteeName: `Invitee ${i}`, inviteeEmail: `co${i}@example.test`, inviteeTimeZone: "UTC" });
const day = DateTime.utc().plus({ days: 21 }).startOf("day");
const range = [day.toISO()!, day.plus({ days: 1 }).toISO()!] as const;
const at = (h: number, m = 0) => day.set({ hour: h, minute: m }).toISO()!;
const hostRows = (bookingId: string) =>
  sql`SELECT host_id, start_at, status FROM booking_hosts WHERE booking_id = ${bookingId} ORDER BY host_id`;

beforeAll(async () => {
  // Alice is free all day; Bob only 09:00–12:00 UTC. The owner organizes but isn't a host of this event.
  [owner, alice, bob] = await Promise.all([makeUser("owner"), makeUser("alice"), makeUser("bob", 9, 12)]);
  const team = await createTeam(owner, "Collective Test", slug);
  await sql`INSERT INTO team_members (team_id, user_id) VALUES (${team.id}, ${alice.id}), (${team.id}, ${bob.id})`;
  const [e] = await sql`
    INSERT INTO event_types (user_id, team_id, scheduling, slug, title, duration_minutes, minimum_notice_minutes)
    VALUES (${owner.id}, ${team.id}, 'collective', 'all', 'All hands', 30, 0) RETURNING id`;
  await sql`INSERT INTO event_type_hosts (event_type_id, user_id) VALUES (${e.id}, ${alice.id}), (${e.id}, ${bob.id})`;
});

afterAll(async () => {
  await cleanup();
  await (await boss()).stop({ graceful: false });
  await sql.end();
});

describe("collective event types", () => {
  it("offers only the times every host is free", async () => {
    const slots = await getSlots(slug, "all", ...range);
    expect(slots.map((s) => s.start)).toEqual([9, 9.5, 10, 10.5, 11, 11.5].map((h) => at(Math.floor(h), (h % 1) * 60)));
  });

  it("books every host into one meeting, and concurrent requests produce exactly one booking", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => book(at(9), i)));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof BookingError)).toBe(true);

    const { booking, hosts } = (ok[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof book>>>).value;
    expect(new Set(hosts.map((h) => h.id))).toEqual(new Set([alice.id, bob.id]));
    expect((await hostRows(booking.id)).map((r) => r.host_id).sort()).toEqual([alice.id, bob.id].sort());

    // The time is gone for the team, and the extra host is protected by the database too.
    expect((await getSlots(slug, "all", ...range)).some((s) => s.start === at(9))).toBe(false);
    const extra = hosts[1];
    const [ev] = await sql`SELECT id FROM event_types WHERE slug = 'all' AND team_id = (SELECT id FROM teams WHERE slug = ${slug})`;
    await expect(sql`
      INSERT INTO bookings (event_type_id, host_id, ical_uid, start_at, end_at, invitee_name, invitee_email, invitee_time_zone, manage_token_hash)
      VALUES (${ev.id}, ${extra.id}, ${crypto.randomUUID()}, ${at(9, 15)}, ${at(9, 45)}, 'x', 'x@example.test', 'UTC', 'x')`).rejects.toMatchObject({ code: "23P01" });
  });

  it("a host's personal meeting removes the time for the whole collective event", async () => {
    const [personal] = await sql`
      INSERT INTO event_types (user_id, schedule_id, slug, title, duration_minutes)
      VALUES (${bob.id}, (SELECT id FROM schedules WHERE user_id = ${bob.id}), 'mine', 'Mine', 30) RETURNING id`;
    await sql`
      INSERT INTO bookings (event_type_id, host_id, ical_uid, start_at, end_at, invitee_name, invitee_email, invitee_time_zone, manage_token_hash)
      VALUES (${personal.id}, ${bob.id}, ${crypto.randomUUID()}, ${at(11)}, ${at(11, 30)}, 'x', 'x@example.test', 'UTC', 'x')`;
    const starts = (await getSlots(slug, "all", ...range)).map((s) => s.start);
    expect(starts).not.toContain(at(11));
    await expect(book(at(11), 50)).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" });
  });

  it("rescheduling moves every host, and any host can cancel", async () => {
    const { booking, manageToken, hosts } = await book(at(10), 60);
    await expect(rescheduleBooking(booking.id, { kind: "invitee", token: manageToken }, at(15))).rejects.toMatchObject({ code: "SLOT_UNAVAILABLE" }); // Bob is off
    await rescheduleBooking(booking.id, { kind: "invitee", token: manageToken }, at(10, 30));
    expect((await hostRows(booking.id)).map((r) => new Date(r.start_at).toISOString())).toEqual([at(10, 30), at(10, 30)].map((t) => new Date(t).toISOString()));
    expect((await getSlots(slug, "all", ...range)).map((s) => s.start)).toContain(at(10));

    await cancelBooking(booking.id, { kind: "host", hostId: hosts[1].id });
    expect((await hostRows(booking.id)).map((r) => r.status)).toEqual(["cancelled", "cancelled"]);
    expect((await getSlots(slug, "all", ...range)).map((s) => s.start)).toContain(at(10, 30));
    await expect(cancelBooking(booking.id, { kind: "host", hostId: owner.id })).rejects.toMatchObject({ code: "NOT_FOUND" }); // not a host of it
  });
});
