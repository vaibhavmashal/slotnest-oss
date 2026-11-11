// Reminder workflows end to end: scheduling from the event type, and sending through the dev SMTP server (Mailpit).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { and, eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { eventTypes, users } from "@/db/schema";
import { createBooking, getSlots } from "@/lib/booking/service";
import { boss } from "./queue";
import { onConfirmed, onReminder } from "./effects";

const MAILPIT = "http://localhost:8026/api/v1";
const SLUG = `remind-${Date.now().toString(36)}`;
const email = `remind-${Date.now().toString(36)}@example.test`;
let eventId = "";
let bookingId = "";

beforeAll(async () => {
  const [row] = await db
    .select({ e: eventTypes })
    .from(eventTypes)
    .innerJoin(users, eq(users.id, eventTypes.userId))
    .where(and(eq(users.username, "at20"), eq(eventTypes.slug, "fit-call")));
  const { id: _id, createdAt: _c, ...copy } = row.e;
  const [e] = await db
    .insert(eventTypes)
    .values({
      ...copy,
      slug: SLUG,
      reminders: [
        { id: "before2d", when: "before", minutes: 2880, to: "invitee", subject: "See you soon, {{name}}", body: "Hi {{name}},\nYour {{event}} is on {{time}}." },
        { id: "thanks", when: "after", minutes: 60, to: "invitee" },
      ],
    })
    .returning();
  eventId = e.id;
});

afterAll(async () => {
  if (bookingId) {
    await sql`DELETE FROM pgboss.job WHERE data->>'bookingId' = ${bookingId}`;
    await sql`DELETE FROM bookings WHERE id = ${bookingId}`;
  }
  if (eventId) await db.delete(eventTypes).where(eq(eventTypes.id, eventId));
  await (await boss()).stop({ graceful: false });
  await sql.end();
});

async function mailTo(addr: string) {
  const res = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:${addr}`)}`);
  const { messages } = (await res.json()) as { messages: { ID: string; Subject: string }[] };
  return Promise.all(messages.map(async (m) => ({ subject: m.Subject, text: ((await (await fetch(`${MAILPIT}/message/${m.ID}`)).json()) as { Text: string }).Text })));
}

describe("reminder workflows", () => {
  it("queues one job per reminder at the right time, and sends custom and built-in wording", async () => {
    const slots = await getSlots("at20", SLUG, DateTime.utc().plus({ days: 4 }).toISO()!, DateTime.utc().plus({ days: 30 }).toISO()!);
    const start = slots[Math.floor(slots.length / 2) + Math.floor(Math.random() * 10)].start;
    const { booking } = await createBooking({ handle: "at20", slug: SLUG, start, inviteeName: "Rae Mind", inviteeEmail: email, inviteeTimeZone: "UTC" });
    bookingId = booking.id;

    // Run the confirmation handler here (it schedules the reminders), not in a dev server's worker.
    await sql`DELETE FROM pgboss.job WHERE name = 'booking-confirmed' AND data->>'bookingId' = ${bookingId}`;
    await onConfirmed({ bookingId });
    const jobs = await sql<{ data: { reminderId: string }; start_after: Date }[]>`
      SELECT data, start_after FROM pgboss.job WHERE name = 'booking-reminder' AND data->>'bookingId' = ${bookingId} ORDER BY start_after`;
    expect(jobs.map((j) => j.data.reminderId)).toEqual(["before2d", "thanks"]);
    expect(new Date(jobs[0].start_after).getTime()).toBe(booking.startAt.getTime() - 2880 * 60_000);
    expect(new Date(jobs[1].start_after).getTime()).toBe(booking.endAt.getTime() + 60 * 60_000);

    const startAt = booking.startAt.toISOString();
    await onReminder({ bookingId, startAt, reminderId: "before2d" });
    await onReminder({ bookingId, startAt, reminderId: "thanks" });
    await onReminder({ bookingId, startAt, reminderId: "gone" }); // removed reminder: nothing sent
    await onReminder({ bookingId, startAt: new Date(0).toISOString(), reminderId: "thanks" }); // stale time: nothing sent

    const mail = await mailTo(email);
    const custom = mail.find((m) => m.subject === "See you soon, Rae Mind")!;
    expect(custom.text).toContain("Hi Rae Mind,");
    expect(custom.text).toMatch(/Your .+ is on \w+day, \d+ \w+ \d{4}/);
    expect(mail.filter((m) => m.subject.startsWith("Thanks for meeting"))).toHaveLength(1);
    expect(mail.filter((m) => m.subject.startsWith("Confirmed"))).toHaveLength(1);
    expect(mail).toHaveLength(3);
  });
});
