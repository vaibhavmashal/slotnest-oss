// Outgoing webhooks: a user's endpoints get a signed JSON POST when a booking is created, rescheduled or cancelled.
// Deliveries run as retried jobs (see jobs/queue). Endpoints must be public https addresses; private and loopback
// addresses are refused at connect time, so DNS tricks can't point a webhook at our own network.
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { bookingHosts, bookings, eventTypes, users, webhooks, type WebhookEvent } from "@/db/schema";
import { config } from "@/lib/config";
import { decrypt, encrypt } from "@/lib/crypto";
import { eventContext, hasPaidFeatures, publicUrl } from "@/lib/teams";
import { isHttpsUrl } from "@/lib/urls";
import { enqueue } from "@/lib/jobs/queue";
import { isPrivateAddress, signature } from "./sign";

export { isPrivateAddress, signature };

export const WEBHOOK_EVENTS: WebhookEvent[] = ["booking.created", "booking.rescheduled", "booking.cancelled"];
export const MAX_WEBHOOKS = 10;
const TIMEOUT_MS = 10_000;

/** Local testing only: lets webhooks reach http:// and private addresses. Never set in production. */
const allowPrivate = () => process.env.WEBHOOKS_ALLOW_PRIVATE === "1";

export class WebhookError extends Error {}

export function validWebhookUrl(url: string): boolean {
  if (isHttpsUrl(url)) return true;
  return allowPrivate() && /^http:\/\/[^/]+/.test(url);
}

export async function listWebhooks(userId: string) {
  return db.select().from(webhooks).where(eq(webhooks.userId, userId)).orderBy(asc(webhooks.createdAt));
}

export const webhookSecret = (w: typeof webhooks.$inferSelect) => decrypt(w.secretEnc);

export async function createWebhook(userId: string, url: string, events: WebhookEvent[]) {
  if (!validWebhookUrl(url)) throw new WebhookError("Webhook addresses must start with https://");
  const chosen = WEBHOOK_EVENTS.filter((e) => events.includes(e));
  if (chosen.length === 0) throw new WebhookError("Choose at least one event");
  const [{ n }] = await db.select({ n: sql<number>`count(*)`.mapWith(Number) }).from(webhooks).where(eq(webhooks.userId, userId));
  if (n >= MAX_WEBHOOKS) throw new WebhookError(`You can have up to ${MAX_WEBHOOKS} webhooks`);
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  const [row] = await db.insert(webhooks).values({ userId, url, events: chosen, secretEnc: encrypt(secret) }).returning();
  return row;
}

export async function deleteWebhook(userId: string, id: string) {
  await db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)));
}

// ---- Payloads ------------------------------------------------------------------------------------

export interface WebhookPayload {
  event: WebhookEvent | "ping";
  /** Unique per booking change; the same id is sent again on retries, so receivers can skip duplicates. */
  id: string;
  created_at: string;
  data: Record<string, unknown>;
}

async function bookingPayload(bookingId: string, event: WebhookEvent, previousStart?: string): Promise<WebhookPayload | null> {
  const [row] = await db
    .select({ booking: bookings, eventType: eventTypes, organizer: users })
    .from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .innerJoin(users, eq(users.id, bookings.hostId))
    .where(eq(bookings.id, bookingId));
  if (!row) return null;
  const { booking: b, eventType: e } = row;
  const hosts = await db
    .select({ name: users.name, email: users.email })
    .from(bookingHosts)
    .innerJoin(users, eq(users.id, bookingHosts.hostId))
    .where(eq(bookingHosts.bookingId, bookingId))
    .orderBy(asc(users.name));
  const ctx = await eventContext(e, row.organizer);
  return {
    event,
    id: `${b.id}:${b.icalSequence}:${event}`,
    created_at: new Date().toISOString(),
    data: {
      booking_id: b.id,
      status: b.status,
      start: b.startAt.toISOString(),
      end: b.endAt.toISOString(),
      ...(previousStart && { previous_start: previousStart }),
      event_type: { id: e.id, slug: e.slug, title: e.title, duration_minutes: e.durationMinutes, seats_per_slot: e.seatsPerSlot, url: publicUrl(ctx, e) },
      team: ctx.team ? { slug: ctx.team.slug, name: ctx.team.name } : null,
      invitee: { name: b.inviteeName, email: b.inviteeEmail, time_zone: b.inviteeTimeZone },
      hosts,
      answers: b.answers.map((a) => ({ question: a.label, answer: a.value })),
      notes: b.notes,
      meeting_url: b.meetingUrl,
      location: e.locationKind,
      payment: b.paymentStatus === "none" ? null : { status: b.paymentStatus, amount: b.paymentAmount, currency: b.paymentCurrency },
      ...(b.manageTokenEnc && { manage_url: `${config.appUrl}/b/${b.id}?t=${decrypt(b.manageTokenEnc)}` }),
      ...(b.status === "cancelled" && { cancel_reason: b.cancelReason, cancelled_at: b.cancelledAt?.toISOString() ?? null }),
    },
  };
}

/** Queue a delivery to every active webhook that wants this event: the event type's owner's, and each host's. */
export async function dispatchBookingWebhooks(bookingId: string, event: WebhookEvent, previousStart?: string) {
  const [b] = await db.select({ ownerId: eventTypes.userId }).from(bookings).innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId)).where(eq(bookings.id, bookingId));
  if (!b) return;
  const hostIds = (await db.select({ id: bookingHosts.hostId }).from(bookingHosts).where(eq(bookingHosts.bookingId, bookingId))).map((h) => h.id);
  const rows = await db
    .select({ id: webhooks.id, owner: users })
    .from(webhooks)
    .innerJoin(users, eq(users.id, webhooks.userId))
    .where(
      and(
        eq(webhooks.isActive, true),
        sql`${event} = ANY(${webhooks.events})`,
        or(eq(webhooks.userId, b.ownerId), hostIds.length ? inArray(webhooks.userId, hostIds) : undefined),
      ),
    );
  // Webhooks are a paid feature: accounts on the Free plan keep theirs but nothing is sent.
  const targets = [];
  for (const r of rows) if (await hasPaidFeatures(r.owner)) targets.push(r);
  if (targets.length === 0) return;
  const payload = await bookingPayload(bookingId, event, previousStart);
  if (!payload) return;
  for (const t of targets) {
    await enqueue("webhook-delivery", { webhookId: t.id, payload }, { singletonKey: `${t.id}:${payload.id}` });
  }
}

// ---- Delivery ------------------------------------------------------------------------------------

/** DNS lookup for the request that refuses private addresses (checked on the address actually connected to). */
const safeLookup: typeof lookup = ((hostname: string, options: any, callback: any) => {
  lookup(hostname, { ...options, all: true }, (err, addresses: any) => {
    if (err) return callback(err);
    const list = (addresses as { address: string; family: number }[]).filter((a) => allowPrivate() || !isPrivateAddress(a.address));
    if (list.length === 0) return callback(Object.assign(new Error("Webhook address is not a public internet address"), { code: "EPRIVATE" }));
    if (options?.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}) as typeof lookup;

function post(url: string, body: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (isIP(u.hostname.replace(/^\[|\]$/g, "")) && !allowPrivate() && isPrivateAddress(u.hostname.replace(/^\[|\]$/g, ""))) {
      return reject(new Error("Webhook address is not a public internet address"));
    }
    const mod = u.protocol === "http:" ? http : https;
    const req = mod.request(
      u,
      { method: "POST", lookup: safeLookup, timeout: TIMEOUT_MS, headers: { ...headers, "content-length": Buffer.byteLength(body).toString() } },
      (res) => {
        res.resume(); // we only need the status; redirects are not followed
        res.on("end", () => resolve(res.statusCode ?? 0));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`No response within ${TIMEOUT_MS / 1000} seconds`)));
    req.on("error", reject);
    req.end(body);
  });
}

/** Send one payload and record the outcome on the webhook. Throws on failure so the job is retried. */
export async function deliver(webhookId: string, payload: WebhookPayload): Promise<{ status: number }> {
  const [w] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId));
  if (!w || (!w.isActive && payload.event !== "ping")) return { status: 0 }; // deleted or paused: drop quietly
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000);
  let status = 0;
  let error: string | null = null;
  try {
    status = await post(w.url, body, {
      "content-type": "application/json",
      "user-agent": "Slotnest-Webhooks/1",
      "slotnest-event": payload.event,
      "slotnest-delivery": payload.id,
      "slotnest-signature": signature(webhookSecret(w), body, ts),
    });
    if (status < 200 || status >= 300) error = `The endpoint answered HTTP ${status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  await db.update(webhooks).set({ lastStatus: status || null, lastError: error, lastDeliveredAt: new Date() }).where(eq(webhooks.id, w.id));
  if (error) throw new WebhookError(error);
  return { status };
}

/** A "ping" sent straight away from the dashboard, so people can check their endpoint. */
export async function sendTestPing(userId: string, webhookId: string) {
  const [w] = await db.select().from(webhooks).where(and(eq(webhooks.id, webhookId), eq(webhooks.userId, userId)));
  if (!w) throw new WebhookError("Webhook not found");
  return deliver(w.id, {
    event: "ping",
    id: `ping:${randomBytes(8).toString("hex")}`,
    created_at: new Date().toISOString(),
    data: { message: "Slotnest can reach this endpoint." },
  });
}
