// Creates the Slotnest products and prices in Stripe (and optionally the webhook endpoint) and prints the env lines to add.
// Uses STRIPE_SECRET_KEY from the environment or .env.local. Refuses live keys unless run with --live.
// Safe to re-run: prices are found again by lookup key, and an existing webhook for the same URL is reported, not duplicated.
//   npm run stripe:setup                                   (test mode)
//   npm run stripe:setup -- --live --webhook=https://slotnest.at20.ai/api/billing/webhook
// The hosted plan prices (change the amounts here before running if you want your own):
//   Solo: $40 one-time + $20/year per seat. Team: $64 one-time + $32/year per seat.
import { existsSync } from "node:fs";
import Stripe from "stripe";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const key = process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("Set STRIPE_SECRET_KEY first (a test-mode key, sk_test_…).");
const live = /^(sk|rk)_live_/.test(key);
if (live && !process.argv.includes("--live")) throw new Error("Refusing to use a live key without --live.");
const webhookUrl = process.argv.find((a) => a.startsWith("--webhook="))?.slice("--webhook=".length);

const stripe = new Stripe(key);
const PLANS = [
  { plan: "SOLO", name: "Slotnest Solo", setupCents: 4000, yearlyCents: 2000 },
  { plan: "TEAM", name: "Slotnest Team", setupCents: 6400, yearlyCents: 3200 },
];
const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
];

for (const p of PLANS) {
  const setupKey = `slotnest_${p.plan.toLowerCase()}_setup`;
  const yearlyKey = `slotnest_${p.plan.toLowerCase()}_yearly`;
  const existing = await stripe.prices.list({ lookup_keys: [setupKey, yearlyKey], active: true });
  let setup = existing.data.find((x) => x.lookup_key === setupKey);
  let yearly = existing.data.find((x) => x.lookup_key === yearlyKey);
  if (!setup || !yearly) {
    const product = (setup ?? yearly)?.product ?? (await stripe.products.create({ name: p.name })).id;
    const productId = typeof product === "string" ? product : product.id;
    setup ??= await stripe.prices.create({
      product: productId, currency: "usd", unit_amount: p.setupCents, lookup_key: setupKey,
      nickname: `${p.name} setup (one-time, per seat)`,
    });
    yearly ??= await stripe.prices.create({
      product: productId, currency: "usd", unit_amount: p.yearlyCents, recurring: { interval: "year" }, lookup_key: yearlyKey,
      nickname: `${p.name} maintenance (yearly, per seat)`,
    });
  }
  console.log(`STRIPE_PRICE_${p.plan}_SETUP=${setup.id}`);
  console.log(`STRIPE_PRICE_${p.plan}_YEARLY=${yearly.id}`);
}

if (webhookUrl) {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  if (endpoints.data.some((e) => e.url === webhookUrl)) {
    // Stripe only reveals a signing secret when the endpoint is created; reuse the one already saved.
    console.error(`A webhook for ${webhookUrl} already exists; keep the STRIPE_WEBHOOK_SECRET you saved for it.`);
  } else {
    const endpoint = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: WEBHOOK_EVENTS, description: "Slotnest" });
    console.log(`STRIPE_WEBHOOK_SECRET=${endpoint.secret}`);
  }
}
