// Webhook handling against the dev database. Payloads are signed locally with a dummy secret,
// so no Stripe account or network access is needed.
import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_local_tests";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_dummy_for_local_tests";
});

import Stripe from "stripe";
import { sql } from "@/db/client";
import { canAcceptBookings, onPaidPlan, planName } from "./access";
import { handleWebhook } from "./stripe";

const signer = new Stripe("sk_test_dummy_for_local_tests");
const sign = (payload: string) => signer.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET! });

let userId: string;
const subId = `sub_test_${Date.now()}`;

afterAll(async () => {
  if (userId) await sql`DELETE FROM users WHERE id = ${userId}`;
  await sql`DELETE FROM stripe_events WHERE id LIKE 'evt_test_%'`;
  await sql.end();
});

function subscriptionEvent(id: string, status: string, periodEnd: number) {
  return JSON.stringify({
    id,
    object: "event",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: subId,
        object: "subscription",
        customer: "cus_test_123",
        status,
        metadata: { userId, plan: "team", seats: "3" },
        items: { object: "list", data: [{ id: "si_1", quantity: 3, current_period_end: periodEnd, price: { id: "price_y", recurring: { interval: "year" } } }] },
      },
    },
  });
}

describe("stripe webhooks", () => {
  it("activates, marks past_due and cancels a subscription; ignores replays", async () => {
    [{ id: userId }] = await sql`
      INSERT INTO users (email, name, username, time_zone, trial_ends_at)
      VALUES (${`billing-${Date.now()}@example.test`}, 'Billing Test', ${`billing-${Date.now()}`}, 'UTC', now() - interval '1 day')
      RETURNING id`;
    const load = async () => (await sql`SELECT billing_status, plan, seats, maintenance_paid_until, stripe_subscription_id FROM users WHERE id = ${userId}`)[0];

    // An ended trial is the Free plan: booking pages stay open, the paid features don't.
    const ended = { billingStatus: "trialing" as const, trialEndsAt: new Date(Date.now() - 86_400_000), plan: "solo" as const };
    expect(canAcceptBookings(ended)).toBe(true);
    expect(onPaidPlan(ended)).toBe(false);
    expect(planName(ended)).toBe("Free");

    const periodEnd = Math.floor(Date.UTC(2027, 10, 1) / 1000);
    const active = subscriptionEvent(`evt_test_${Date.now()}_1`, "active", periodEnd);
    await handleWebhook(active, sign(active));
    let u = await load();
    expect(u).toMatchObject({ billing_status: "active", plan: "team", seats: 3, stripe_subscription_id: subId });
    expect(new Date(u.maintenance_paid_until).toISOString()).toBe("2027-11-01T00:00:00.000Z");

    const pastDue = subscriptionEvent(`evt_test_${Date.now()}_2`, "past_due", periodEnd);
    await handleWebhook(pastDue, sign(pastDue));
    expect((await load()).billing_status).toBe("past_due");

    // Replaying the earlier "active" event must not flip the status back.
    await handleWebhook(active, sign(active));
    expect((await load()).billing_status).toBe("past_due");

    const canceled = subscriptionEvent(`evt_test_${Date.now()}_3`, "canceled", periodEnd);
    await handleWebhook(canceled, sign(canceled));
    expect((await load()).billing_status).toBe("canceled");
    // A cancelled subscription falls back to Free.
    expect(planName({ billingStatus: "canceled", trialEndsAt: new Date(0), plan: "team" })).toBe("Free");
    expect(onPaidPlan({ billingStatus: "canceled", trialEndsAt: new Date(0) })).toBe(false);
  });

  it("rejects payloads with a bad signature", async () => {
    const body = subscriptionEvent("evt_test_bad", "active", 0);
    await expect(handleWebhook(body, sign(body + "tampered"))).rejects.toThrow();
  });
});
