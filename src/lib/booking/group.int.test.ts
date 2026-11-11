// Group events (several invitees per slot), against the dev Postgres (see service.int.test.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { and, eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { eventTypes, users } from "@/db/schema";
import { boss } from "@/lib/jobs/queue";
import { newToken } from "@/lib/crypto";
import { BookingError, cancelBooking, createBooking, getSlots, rescheduleBooking } from "./service";

const SLUG = `group-${Date.now().toString(36)}`;
const SEATS = 3;
const created: string[] = [];
let eventId = "";
let hostId = "";

beforeAll(async () => {
  const [row] = await db
    .select({ e: eventTypes, u: users })
    .from(eventTypes)
    .innerJoin(users, eq(users.id, eventTypes.userId))
    .where(and(eq(users.username, "at20"), eq(eventTypes.slug, "fit-call")));
  hostId = row.u.id;
  const { id: _id, createdAt: _c, ...copy } = row.e;
  const [e] = await db.insert(eventTypes).values({ ...copy, slug: SLUG, seatsPerSlot: SEATS, maxPerDay: null }).returning();
  eventId = e.id;
});

afterAll(async () => {
  if (created.length) {
    await sql`DELETE FROM pgboss.job WHERE data->>'bookingId' = ANY(${created})`;
    await sql`DELETE FROM bookings WHERE id = ANY(${created})`;
  }
  if (eventId) await db.delete(eventTypes).where(eq(eventTypes.id, eventId));
  await (await boss()).stop({ graceful: false });
  await sql.end();
});

const range = () => [DateTime.utc().toISO()!, DateTime.utc().plus({ days: 30 }).toISO()!] as const;
const slots = () => getSlots("at20", SLUG, ...range());
const book = (start: string, i: number) =>
  createBooking({ handle: "at20", slug: SLUG, start, inviteeName: `Guest ${i}`, inviteeEmail: `guest${i}@example.test`, inviteeTimeZone: "UTC" }).then((r) => {
    created.push(r.booking.id);
    return r;
  });

describe("group events", () => {
  let start = "";

  it("offers every free slot with all seats, then counts seats down as people book", async () => {
    const all = await slots();
    // Somewhere in the middle, away from the times other test files book.
    start = all[Math.floor(all.length / 2) + Math.floor(Math.random() * 10)].start;
    expect(all.find((s) => s.start === start)!.seatsLeft).toBe(SEATS);

    const first = await book(start, 1);
    expect(first.booking.sessionKey).toBe(`${eventId}:${DateTime.fromISO(start).toUTC().toISO()}`);
    expect((await slots()).find((s) => Date.parse(s.start) === Date.parse(start))!.seatsLeft).toBe(SEATS - 1);
  });

  it("lets concurrent invitees fill the remaining seats exactly", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => book(start, 10 + i)));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(SEATS - 1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof BookingError)).toBe(true);
    expect((await slots()).some((s) => Date.parse(s.start) === Date.parse(start))).toBe(false); // full
  });

  it("blocks the host's other event types during the session", async () => {
    const fit = await getSlots("at20", "fit-call", ...range());
    expect(fit.some((s) => Date.parse(s.start) === Date.parse(start))).toBe(false);
  });

  it("reopens a seat when someone cancels, and lets another invitee move into it", async () => {
    const [someone] = created.slice(-1);
    await cancelBooking(someone, { kind: "host", hostId });
    expect((await slots()).find((s) => Date.parse(s.start) === Date.parse(start))!.seatsLeft).toBe(1);

    // Someone booked at a different time reschedules into the open seat.
    const other = (await slots()).find((s) => s.seatsLeft === SEATS && Math.abs(Date.parse(s.start) - Date.parse(start)) > 86_400_000)!;
    const mover = await book(other.start, 99);
    const moved = await rescheduleBooking(mover.booking.id, { kind: "host", hostId }, start);
    expect(moved.sessionKey).toBe(`${eventId}:${DateTime.fromISO(start).toUTC().toISO()}`);
    expect((await slots()).some((s) => Date.parse(s.start) === Date.parse(start))).toBe(false); // full again
    // Their old time is free again, with all seats.
    expect((await slots()).find((s) => s.start === other.start)!.seatsLeft).toBe(SEATS);
  });

  it("refuses a booking that would overlap a session at a different start time", async () => {
    // A one-on-one booking directly in the database, overlapping the session by 15 minutes, must hit the constraint.
    const s = DateTime.fromISO(start).toUTC();
    const err = await sql`
      INSERT INTO bookings (event_type_id, host_id, ical_uid, start_at, end_at, invitee_name, invitee_email, invitee_time_zone, manage_token_hash)
      VALUES (${eventId}, ${hostId}, ${`overlap-${newToken()}`}, ${s.plus({ minutes: 15 }).toISO()}, ${s.plus({ minutes: 45 }).toISO()}, 'X', 'x@example.test', 'UTC', 'x')
    `.catch((e) => e);
    expect(err?.code).toBe("23P01");
  });
});
