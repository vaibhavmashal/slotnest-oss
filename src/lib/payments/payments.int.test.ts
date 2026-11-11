// Paid bookings against the dev Postgres, with Stripe replaced by an in-memory fake (no network, no keys).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { and, eq } from "drizzle-orm";

const fake = vi.hoisted(() => {
  const sessions = new Map<string, { id: string; url: string; payment_status: string; status: string; payment_intent: string | null; account: string }>();
  const refunds: { payment_intent: string; account: string }[] = [];
  let n = 0;
  const client = {
    checkout: {
      sessions: {
        create: async (_p: unknown, o: { stripeAccount: string }) => {
          const id = `cs_test_${++n}`;
          const s = { id, url: `https://checkout.stripe.test/${id}`, payment_status: "unpaid", status: "open", payment_intent: null, account: o.stripeAccount };
          sessions.set(id, s);
          return s;
        },
        retrieve: async (id: string, _p: unknown, o: { stripeAccount: string }) => {
          const s = sessions.get(id)!;
          if (s.account !== o.stripeAccount) throw new Error("wrong account");
          return s;
        },
        expire: async (id: string) => {
          sessions.get(id)!.status = "expired";
          return sessions.get(id);
        },
      },
    },
    refunds: {
      create: async (p: { payment_intent: string }, o: { stripeAccount: string }) => {
        refunds.push({ payment_intent: p.payment_intent, account: o.stripeAccount });
        return { id: "re_1" };
      },
    },
  };
  const pay = (sessionId: string) => Object.assign(sessions.get(sessionId)!, { payment_status: "paid", status: "complete", payment_intent: `pi_${sessionId}` });
  return { client, sessions, refunds, pay };
});

vi.mock("@/lib/billing/stripe", () => ({ stripe: () => fake.client }));
vi.mock("@/lib/config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/config")>();
  return { ...mod, config: { ...mod.config, stripe: { secretKey: "sk_test_fake", webhookSecret: "whsec_fake", prices: { solo: {}, team: {} } } } };
});

import { db, sql } from "@/db/client";
import { bookings, eventTypes, users } from "@/db/schema";
import { BookingError, cancelBooking, createBooking, getSlots } from "@/lib/booking/service";
import { boss } from "@/lib/jobs/queue";
import { onCancelled } from "@/lib/jobs/effects";
import { abandonCheckout, checkPayment } from "./index";
import { formatPrice, parsePrice } from "./currencies";

const SLUG = `paid-${Date.now().toString(36)}`;
const ACCOUNT = "acct_test_host";
const created: string[] = [];
let eventId = "";
let host: typeof users.$inferSelect;
let original: Pick<typeof users.$inferSelect, "stripeAccountId" | "stripeChargesEnabled" | "billingStatus" | "trialEndsAt">;

beforeAll(async () => {
  const [row] = await db
    .select({ e: eventTypes, u: users })
    .from(eventTypes)
    .innerJoin(users, eq(users.id, eventTypes.userId))
    .where(and(eq(users.username, "at20"), eq(eventTypes.slug, "fit-call")));
  host = row.u;
  original = { stripeAccountId: host.stripeAccountId, stripeChargesEnabled: host.stripeChargesEnabled, billingStatus: host.billingStatus, trialEndsAt: host.trialEndsAt };
  // With Stripe "configured", billing is enforced: keep the host's own trial running for the test.
  await db
    .update(users)
    .set({ stripeAccountId: null, stripeChargesEnabled: false, billingStatus: "trialing", trialEndsAt: DateTime.utc().plus({ days: 7 }).toJSDate() })
    .where(eq(users.id, host.id));
  const { id: _id, createdAt: _c, ...copy } = row.e;
  const [e] = await db.insert(eventTypes).values({ ...copy, slug: SLUG, priceAmount: 5000, priceCurrency: "usd", refundOnCancel: true }).returning();
  eventId = e.id;
});

afterAll(async () => {
  if (created.length) {
    await sql`DELETE FROM pgboss.job WHERE data->>'bookingId' = ANY(${created})`;
    await sql`DELETE FROM bookings WHERE id = ANY(${created})`;
  }
  if (eventId) await db.delete(eventTypes).where(eq(eventTypes.id, eventId));
  await db.update(users).set(original).where(eq(users.id, host.id));
  await (await boss()).stop({ graceful: false });
  await sql.end();
});

async function aSlot() {
  const slots = await getSlots("at20", SLUG, DateTime.utc().toISO()!, DateTime.utc().plus({ days: 30 }).toISO()!);
  return slots[Math.floor(slots.length / 3) + Math.floor(Math.random() * 20)].start;
}
async function book(start: string) {
  const r = await createBooking({ handle: "at20", slug: SLUG, start, inviteeName: "Pay Er", inviteeEmail: "payer@example.test", inviteeTimeZone: "UTC" });
  created.push(r.booking.id);
  return r;
}
const jobs = (bookingId: string, name: string) =>
  sql<{ start_after: string }[]>`SELECT start_after FROM pgboss.job WHERE name = ${name} AND data->>'bookingId' = ${bookingId}`;
const load = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0];

describe("prices", () => {
  it("parses and formats amounts", () => {
    expect(parsePrice("50", "usd")).toBe(5000);
    expect(parsePrice("49.99", "eur")).toBe(4999);
    expect(parsePrice("0.10", "usd")).toBeNull(); // below Stripe's minimum
    expect(parsePrice("1,000", "usd")).toBeNull();
    expect(parsePrice("10", "xyz")).toBeNull();
    expect(formatPrice(150000, "inr")).toBe("₹1,500.00");
  });
});

describe("paid bookings", () => {
  it("refuse bookings until the host's Stripe account can take payments", async () => {
    const err = await book(await aSlot()).catch((e) => e);
    expect(err).toBeInstanceOf(BookingError);
    expect(err.code).toBe("NOT_ACCEPTING");
    await db.update(users).set({ stripeAccountId: ACCOUNT, stripeChargesEnabled: true }).where(eq(users.id, host.id));
  });

  it("hold the slot while the invitee pays, then confirm once Stripe says it's paid", async () => {
    const start = await aSlot();
    const { booking, checkoutUrl } = await book(start);
    expect(checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.test\//);
    expect(booking.paymentStatus).toBe("pending");
    expect(booking.stripeAccountId).toBe(ACCOUNT);
    expect(await jobs(booking.id, "booking-confirmed")).toHaveLength(0); // nothing sent before payment
    expect(await jobs(booking.id, "payment-check")).toHaveLength(2);
    // The time is held for everyone else.
    const slots = await getSlots("at20", SLUG, DateTime.utc().toISO()!, DateTime.utc().plus({ days: 30 }).toISO()!);
    expect(slots.some((s) => Date.parse(s.start) === Date.parse(start))).toBe(false);

    expect(await checkPayment(booking.id)).toBe("pending");
    const { stripeCheckoutSessionId } = await load(booking.id);
    fake.pay(stripeCheckoutSessionId!);
    expect(await checkPayment(booking.id)).toBe("paid");
    expect(await checkPayment(booking.id)).toBe("paid"); // idempotent
    const paid = await load(booking.id);
    expect(paid.stripePaymentIntentId).toBe(`pi_${stripeCheckoutSessionId}`);
    expect(await jobs(booking.id, "booking-confirmed")).toHaveLength(1);

    // Cancelling refunds automatically on the host's account.
    await sql`DELETE FROM pgboss.job WHERE data->>'bookingId' = ${booking.id}`; // keep the dev worker out of it
    await cancelBooking(booking.id, { kind: "host", hostId: host.id });
    await sql`DELETE FROM pgboss.job WHERE data->>'bookingId' = ${booking.id}`;
    await onCancelled({ bookingId: booking.id, by: "host" });
    expect(fake.refunds).toContainEqual({ payment_intent: `pi_${stripeCheckoutSessionId}`, account: ACCOUNT });
    expect((await load(booking.id)).paymentStatus).toBe("refunded");
  });

  it("release the slot when the invitee backs out of Checkout", async () => {
    const start = await aSlot();
    const { booking } = await book(start);
    expect(await abandonCheckout(booking.id)).toBe("expired");
    const b = await load(booking.id);
    expect(b.status).toBe("cancelled");
    expect(b.paymentStatus).toBe("expired");
    expect(fake.sessions.get(b.stripeCheckoutSessionId!)!.status).toBe("expired");
    const slots = await getSlots("at20", SLUG, DateTime.utc().toISO()!, DateTime.utc().plus({ days: 30 }).toISO()!);
    expect(slots.some((s) => Date.parse(s.start) === Date.parse(start))).toBe(true);
  });

  it("release an unpaid hold once it runs out, but confirm one paid just before", async () => {
    const a = await book(await aSlot());
    const b = await book(await aSlot());
    await db.update(bookings).set({ paymentExpiresAt: new Date(Date.now() - 1000) }).where(eq(bookings.id, a.booking.id));
    await db.update(bookings).set({ paymentExpiresAt: new Date(Date.now() - 1000) }).where(eq(bookings.id, b.booking.id));
    fake.pay((await load(b.booking.id)).stripeCheckoutSessionId!);
    expect(await checkPayment(a.booking.id)).toBe("expired");
    expect(await checkPayment(b.booking.id)).toBe("paid");
    expect((await load(a.booking.id)).status).toBe("cancelled");
    expect((await load(b.booking.id)).status).toBe("confirmed");
  });

  it("refund a payment that lands after the booking was cancelled", async () => {
    const { booking } = await book(await aSlot());
    await sql`UPDATE bookings SET status = 'cancelled' WHERE id = ${booking.id}`;
    const sessionId = (await load(booking.id)).stripeCheckoutSessionId!;
    fake.pay(sessionId);
    expect(await checkPayment(booking.id)).toBe("refunded");
    expect(fake.refunds).toContainEqual({ payment_intent: `pi_${sessionId}`, account: ACCOUNT });
  });
});
