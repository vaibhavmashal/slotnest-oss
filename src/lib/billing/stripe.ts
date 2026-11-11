import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { stripeEvents, users } from "@/db/schema";
import { config } from "@/lib/config";

export type Plan = "solo" | "team";

let client: Stripe | null = null;
export function stripe(): Stripe {
  if (!config.stripe) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET). See SETUP.md.");
  client ??= new Stripe(config.stripe.secretKey);
  return client;
}

export function planPrices(plan: Plan) {
  const p = config.stripe?.prices[plan];
  if (!p?.setup || !p?.yearly) throw new Error(`Stripe prices for the ${plan} plan are not configured. Run: npm run stripe:setup`);
  return { setup: p.setup, yearly: p.yearly };
}

/** Checkout: one-time setup fee + yearly maintenance subscription, both per seat, on one first invoice. */
export async function createCheckout(user: typeof users.$inferSelect, plan: Plan, seats: number): Promise<string> {
  const prices = planPrices(plan);
  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    line_items: [
      { price: prices.setup, quantity: seats },
      { price: prices.yearly, quantity: seats },
    ],
    ...(user.stripeCustomerId ? { customer: user.stripeCustomerId } : { customer_email: user.email }),
    client_reference_id: user.id,
    metadata: { userId: user.id, plan, seats: String(seats) },
    subscription_data: { metadata: { userId: user.id, plan, seats: String(seats) } },
    allow_promotion_codes: true,
    success_url: `${config.appUrl}/dashboard/billing?success=1`,
    cancel_url: `${config.appUrl}/dashboard/billing?canceled=1`,
  });
  return session.url!;
}

export async function createPortal(customerId: string): Promise<string> {
  const s = await stripe().billingPortal.sessions.create({ customer: customerId, return_url: `${config.appUrl}/dashboard/billing` });
  return s.url;
}

function mapStatus(s: Stripe.Subscription.Status): "active" | "past_due" | "canceled" | null {
  switch (s) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return null; // incomplete / paused: leave as is
  }
}

async function applySubscription(sub: Stripe.Subscription) {
  const userId = sub.metadata?.userId;
  const where = userId ? eq(users.id, userId) : eq(users.stripeSubscriptionId, sub.id);
  const status = mapStatus(sub.status);
  const yearly = sub.items.data.find((i) => i.price.recurring);
  const periodEnd = yearly?.current_period_end;
  await db
    .update(users)
    .set({
      stripeSubscriptionId: sub.id,
      stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      ...(status && { billingStatus: status }),
      ...(sub.metadata?.plan === "solo" || sub.metadata?.plan === "team" ? { plan: sub.metadata.plan } : {}),
      ...(yearly?.quantity ? { seats: yearly.quantity } : {}),
      ...(periodEnd ? { maintenancePaidUntil: new Date(periodEnd * 1000) } : {}),
    })
    .where(where);
}

/** Verify and apply a webhook. Idempotent per Stripe event id. */
export async function handleWebhook(rawBody: string, signature: string): Promise<void> {
  const event = stripe().webhooks.constructEvent(rawBody, signature, config.stripe!.webhookSecret);
  const [seen] = await db.select().from(stripeEvents).where(eq(stripeEvents.id, event.id));
  if (seen) return;

  switch (event.type) {
    case "checkout.session.completed": {
      const s = event.data.object;
      if (s.mode === "subscription" && s.subscription) {
        const subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
        await applySubscription(await stripe().subscriptions.retrieve(subId));
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object);
      break;
  }
  await db.insert(stripeEvents).values({ id: event.id, type: event.type }).onConflictDoNothing();
}

export async function describePrice(id: string | undefined) {
  if (!id || !config.stripe) return null;
  try {
    const p = await stripe().prices.retrieve(id);
    const amount = (p.unit_amount ?? 0) / 100;
    return `${amount.toLocaleString("en-US", { style: "currency", currency: p.currency.toUpperCase() })}${p.recurring ? `/${p.recurring.interval}` : " one-time"}`;
  } catch {
    return null;
  }
}
