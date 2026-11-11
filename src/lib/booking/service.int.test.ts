// Integration tests against the dev Postgres (npm run db:up && npm run db:migrate && npm run db:seed).
// Run with: npm run test:int
import { afterAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { BookingError, createBooking, getSlots } from "./service";
import { sql } from "@/db/client";
import { boss } from "@/lib/jobs/queue";

const createdIds: string[] = [];

afterAll(async () => {
  if (createdIds.length) {
    // Drop the confirmation jobs these test bookings queued, so the dev worker doesn't email them.
    await sql`DELETE FROM pgboss.job WHERE data->>'bookingId' = ANY(${createdIds})`;
    await sql`DELETE FROM bookings WHERE id = ANY(${createdIds})`;
  }
  await (await boss()).stop({ graceful: false });
  await sql.end();
});

describe("double-booking protection", () => {
  it("20 concurrent requests for the same slot produce exactly one booking", async () => {
    const from = DateTime.utc();
    const slots = await getSlots("at20", "fit-call", from.toISO()!, from.plus({ days: 30 }).toISO()!);
    expect(slots.length).toBeGreaterThan(0);
    const target = slots.at(-1)!.start; // furthest out, least likely to collide with manual testing

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        createBooking({
          handle: "at20",
          slug: "fit-call",
          start: target,
          inviteeName: `Racer ${i}`,
          inviteeEmail: `racer${i}@example.test`,
          inviteeTimeZone: "Europe/Berlin",
        }),
      ),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    for (const r of ok) createdIds.push(r.value.booking.id);

    expect(ok).toHaveLength(1);
    expect(rejected.every((r) => r.reason instanceof BookingError && r.reason.code === "SLOT_UNAVAILABLE")).toBe(true);

    const after = await getSlots("at20", "fit-call", from.toISO()!, from.plus({ days: 30 }).toISO()!);
    expect(after.some((s) => s.start === target)).toBe(false);
  });

  it("the exclusion constraint rejects overlapping confirmed bookings even without the service", async () => {
    const [{ host_id, event_type_id }] = await sql`
      SELECT u.id AS host_id, e.id AS event_type_id FROM users u JOIN event_types e ON e.user_id = u.id
      WHERE u.username = 'at20' AND e.slug = 'fit-call'`;
    const insert = (start: string, end: string, status = "confirmed") => sql`
      INSERT INTO bookings (event_type_id, host_id, ical_uid, start_at, end_at, status, invitee_name, invitee_email,
                            invitee_time_zone, manage_token_hash)
      VALUES (${event_type_id}, ${host_id}, ${crypto.randomUUID()}, ${start}, ${end}, ${status}::booking_status,
              'x', 'x@example.test', 'UTC', 'x')
      RETURNING id`;

    const [a] = await insert("2030-01-07T10:00:00Z", "2030-01-07T10:30:00Z");
    createdIds.push(a.id);
    await expect(insert("2030-01-07T10:15:00Z", "2030-01-07T10:45:00Z")).rejects.toMatchObject({ code: "23P01" });

    // Touching end/start is fine ([) ranges), and cancelled bookings don't block.
    const [b] = await insert("2030-01-07T10:30:00Z", "2030-01-07T11:00:00Z");
    const [c] = await insert("2030-01-07T10:00:00Z", "2030-01-07T10:30:00Z", "cancelled");
    createdIds.push(b.id, c.id);
  });
});
