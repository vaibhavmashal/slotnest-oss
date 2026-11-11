// Booking questions, hidden event types and webhook delivery, against the dev Postgres (see service.int.test.ts).
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { and, eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { eventTypes, users, webhooks } from "@/db/schema";
import { boss } from "@/lib/jobs/queue";
import { createWebhook, deliver, dispatchBookingWebhooks, webhookSecret, type WebhookPayload } from "@/lib/webhooks";
import { BookingError, createBooking, getPublicProfile, getSlots } from "./service";

process.env.WEBHOOKS_ALLOW_PRIVATE = "1"; // the test receiver listens on localhost

const createdBookings: string[] = [];
// A throwaway copy of the seed's at20/fit-call, so other test files using fit-call aren't affected.
const SLUG = `batch1-${Date.now().toString(36)}`;
let eventId = "";
let userId = "";
const received: { headers: IncomingMessage["headers"]; body: string }[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ headers: req.headers, body });
    res.statusCode = received.length === 1 ? 500 : 200; // the first delivery fails, to check failures are recorded
    res.end();
  });
});

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const [row] = await db
    .select({ e: eventTypes, u: users })
    .from(eventTypes)
    .innerJoin(users, eq(users.id, eventTypes.userId))
    .where(and(eq(users.username, "at20"), eq(eventTypes.slug, "fit-call")));
  userId = row.u.id;
  const { id: _id, createdAt: _c, ...copy } = row.e;
  const [created] = await db
    .insert(eventTypes)
    .values({
      ...copy,
      slug: SLUG,
      questions: [
        { id: "co", label: "Company", type: "text", required: true },
        { id: "sz", label: "Team size", type: "select", required: false, options: ["1-10", "11-50"] },
      ],
    })
    .returning();
  eventId = created.id;
});

afterAll(async () => {
  await db.delete(webhooks).where(eq(webhooks.userId, userId));
  if (createdBookings.length) {
    await sql`DELETE FROM pgboss.job WHERE data->>'bookingId' = ANY(${createdBookings})`;
    await sql`DELETE FROM bookings WHERE id = ANY(${createdBookings})`;
  }
  if (eventId) await db.delete(eventTypes).where(eq(eventTypes.id, eventId));
  server.close();
  await (await boss()).stop({ graceful: false });
  await sql.end();
});

// Other test files book the same host's late slots concurrently, so pick from earlier in the window.
async function aSlot() {
  const from = DateTime.utc();
  const slots = await getSlots("at20", SLUG, from.toISO()!, from.plus({ days: 30 }).toISO()!);
  return slots[Math.floor(slots.length / 3) + Math.floor(Math.random() * 10)].start;
}

describe("booking questions", () => {
  it("refuses a booking without a required answer", async () => {
    const err = await createBooking({
      handle: "at20", slug: SLUG, start: await aSlot(), inviteeName: "Q Test", inviteeEmail: "q@example.test", inviteeTimeZone: "UTC",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(BookingError);
    expect(err.code).toBe("INVALID");
    expect(err.message).toContain("Company");
  });

  it("stores answers with their labels", async () => {
    const book = async () =>
      createBooking({
        handle: "at20", slug: SLUG, start: await aSlot(), inviteeName: "Q Test", inviteeEmail: "q@example.test", inviteeTimeZone: "UTC",
        answers: { co: "Acme", sz: "11-50" },
      });
    const { booking } = await book().catch(book); // one retry if another test took the slot first
    createdBookings.push(booking.id);
    expect(booking.answers).toEqual([
      { id: "co", label: "Company", value: "Acme" },
      { id: "sz", label: "Team size", value: "11-50" },
    ]);
  });
});

describe("hidden event types", () => {
  it("are left off the profile but still bookable by link", async () => {
    expect((await getPublicProfile("at20"))!.eventTypes.map((e) => e.slug)).toContain(SLUG);
    await db.update(eventTypes).set({ isHidden: true }).where(eq(eventTypes.id, eventId));
    expect((await getPublicProfile("at20"))!.eventTypes.map((e) => e.slug)).not.toContain(SLUG);
    expect((await getSlots("at20", SLUG, DateTime.utc().toISO()!, DateTime.utc().plus({ days: 7 }).toISO()!)).length).toBeGreaterThan(0);
    await db.update(eventTypes).set({ isHidden: false }).where(eq(eventTypes.id, eventId));
  });

  it("returns null for handles that don't exist", async () => {
    expect(await getPublicProfile("no-such-handle-xyz")).toBeNull();
  });
});

describe("webhooks", () => {
  it("delivers a signed booking.created payload and records failures", async () => {
    const port = (server.address() as AddressInfo).port;
    const hook = await createWebhook(userId, `http://127.0.0.1:${port}/hook`, ["booking.created"]);
    const bookingId = createdBookings[0];
    await dispatchBookingWebhooks(bookingId, "booking.created");
    const [job] = await sql<{ data: { webhookId: string; payload: WebhookPayload } }[]>`
      SELECT data FROM pgboss.job WHERE name = 'webhook-delivery' AND data->>'webhookId' = ${hook.id}`;
    expect(job.data.payload.event).toBe("booking.created");

    // First attempt: the receiver answers 500, so delivery throws (and the job would be retried).
    await expect(deliver(hook.id, job.data.payload)).rejects.toThrow(/HTTP 500/);
    const [failed] = await db.select().from(webhooks).where(eq(webhooks.id, hook.id));
    expect(failed.lastStatus).toBe(500);
    expect(failed.lastError).toContain("500");

    await deliver(hook.id, job.data.payload);
    const { headers, body } = received[1];
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(headers["slotnest-signature"]))!;
    expect(createHmac("sha256", webhookSecret(hook)).update(`${t}.${body}`).digest("hex")).toBe(v1);
    expect(headers["slotnest-event"]).toBe("booking.created");
    const payload = JSON.parse(body);
    expect(payload.data).toMatchObject({
      booking_id: bookingId,
      invitee: { name: "Q Test", email: "q@example.test" },
      answers: [{ question: "Company", answer: "Acme" }, { question: "Team size", answer: "11-50" }],
      event_type: { slug: SLUG },
    });
    expect(payload.data.manage_url).toContain(`/b/${bookingId}?t=`);
    const [ok] = await db.select().from(webhooks).where(eq(webhooks.id, hook.id));
    expect(ok.lastStatus).toBe(200);
    expect(ok.lastError).toBeNull();
    await sql`DELETE FROM pgboss.job WHERE name = 'webhook-delivery' AND data->>'webhookId' = ${hook.id}`;
  });

  it("refuses non-https endpoints and private addresses without the local-testing switch", async () => {
    process.env.WEBHOOKS_ALLOW_PRIVATE = "0";
    try {
      await expect(createWebhook(userId, "http://example.com/hook", ["booking.created"])).rejects.toThrow(/https/);
      const hook = await createWebhook(userId, "https://127.0.0.1/hook", ["booking.created"]);
      await expect(deliver(hook.id, { event: "ping", id: "p", created_at: "", data: {} })).rejects.toThrow(/public internet address/);
      const local = await createWebhook(userId, "https://localhost/hook", ["booking.created"]);
      await expect(deliver(local.id, { event: "ping", id: "p", created_at: "", data: {} })).rejects.toThrow(/public internet address/);
    } finally {
      process.env.WEBHOOKS_ALLOW_PRIVATE = "1";
    }
  });
});
