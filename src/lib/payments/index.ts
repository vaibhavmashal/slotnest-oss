// Paid bookings with Stripe Connect. Each host connects their own Stripe account (Stripe-hosted onboarding, full
// Stripe dashboard, Stripe collects fees from them), and invitees pay with Checkout as a direct charge on that
// account, so the money goes straight to the host. Slotnest takes no application fee.
//
// A paid booking is created as 'confirmed' with payment_status 'pending', which holds the slot. Payment is
// confirmed when the invitee returns from Checkout, and re-checked by jobs (in case they closed the tab);
// unpaid holds are released after HOLD_MINUTES. Nothing is emailed or put on calendars until the payment is in.
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { bookings, users } from "@/db/schema";
import { stripe } from "@/lib/billing/stripe";
import { config } from "@/lib/config";
import { enqueue } from "@/lib/jobs/queue";

import { isStripeCountry } from "./countries";

export { CURRENCIES, formatPrice, minimumAmount, parsePrice, type Currency } from "./currencies";
export { countryForZone, countryOptions } from "./countries";

type User = typeof users.$inferSelect;
type Booking = typeof bookings.$inferSelect;

/** Stripe Checkout sessions must stay open at least 30 minutes; the hold lasts a little longer than the session. */
export const CHECKOUT_MINUTES = 30;
export const HOLD_MINUTES = CHECKOUT_MINUTES + 2;

export class PaymentError extends Error {}

export const paymentsAvailable = () => !!config.stripe;

// ---- Connecting a host's Stripe account -----------------------------------------------------------

/**
 * A Stripe onboarding link for the user; creates their connected account (Accounts v2) the first time, in `country`
 * (Stripe needs it up front). Throws PaymentError when a new account is needed but no supported country was given.
 */
export async function onboardingLink(user: User, country?: string): Promise<string> {
  let accountId = user.stripeAccountId;
  if (!accountId) {
    if (!isStripeCountry(country)) throw new PaymentError("Choose a country");
    // A merchant account with the full Stripe dashboard; Stripe collects its fees and covers losses.
    const account = await stripe().v2.core.accounts.create({
      contact_email: user.email,
      display_name: user.name || undefined,
      identity: { country: country.toLowerCase() },
      dashboard: "full",
      configuration: { merchant: { capabilities: { card_payments: { requested: true } } } },
      defaults: { responsibilities: { fees_collector: "stripe", losses_collector: "stripe" } },
      metadata: { slotnestUserId: user.id },
    });
    accountId = account.id;
    await db.update(users).set({ stripeAccountId: accountId }).where(eq(users.id, user.id));
  }
  const link = await stripe().v2.core.accountLinks.create({
    account: accountId,
    use_case: {
      type: "account_onboarding",
      account_onboarding: {
        refresh_url: `${config.appUrl}/api/payments/connect`,
        return_url: `${config.appUrl}/api/payments/return`,
      },
    },
  });
  return link.url;
}

/** Re-read whether the user's connected account can take card payments. */
export async function refreshAccount(user: User): Promise<boolean> {
  if (!user.stripeAccountId) return false;
  const account = await stripe().v2.core.accounts.retrieve(user.stripeAccountId, { include: ["configuration.merchant"] });
  const enabled = account.configuration?.merchant?.capabilities?.card_payments?.status === "active";
  await db.update(users).set({ stripeChargesEnabled: enabled }).where(eq(users.id, user.id));
  return enabled;
}

/** Forget the connected account here (the account itself stays the user's, in Stripe). */
export async function disconnectAccount(user: User) {
  await db.update(users).set({ stripeAccountId: null, stripeChargesEnabled: false }).where(eq(users.id, user.id));
}

// ---- Checkout -------------------------------------------------------------------------------------

/** Create the Checkout Session for a paid booking hold and queue the payment checks. Returns the Checkout URL. */
export async function startCheckout(b: Booking, opts: { title: string; hostName: string; when: string; manageToken: string }): Promise<string> {
  if (!b.stripeAccountId || !b.paymentAmount || !b.paymentCurrency) throw new PaymentError("Booking has no payment");
  const session = await stripe().checkout.sessions.create(
    {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: b.paymentCurrency,
            unit_amount: b.paymentAmount,
            product_data: { name: `${opts.title} with ${opts.hostName}`, description: opts.when },
          },
        },
      ],
      customer_email: b.inviteeEmail,
      expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
      client_reference_id: b.id,
      metadata: { slotnestBookingId: b.id },
      payment_intent_data: { metadata: { slotnestBookingId: b.id }, description: `${opts.title} with ${opts.hostName}, ${opts.when}` },
      success_url: `${config.appUrl}/b/${b.id}?t=${opts.manageToken}&paid=1`,
      cancel_url: `${config.appUrl}/api/payments/cancel?b=${b.id}&t=${opts.manageToken}`,
    },
    { stripeAccount: b.stripeAccountId },
  );
  await db.update(bookings).set({ stripeCheckoutSessionId: session.id }).where(eq(bookings.id, b.id));
  // Re-check soon (the invitee may pay and close the tab), and once more when the hold runs out.
  await enqueue("payment-check", { bookingId: b.id }, { startAfter: 5 * 60 });
  await enqueue("payment-check", { bookingId: b.id }, { startAfter: new Date(Date.now() + HOLD_MINUTES * 60_000 + 30_000) });
  return session.url!;
}

/**
 * Settle a pending payment from Stripe's view of its Checkout Session: confirm the booking when paid, release the
 * hold once it has expired unpaid. Safe to call any number of times. Returns the booking's payment status after.
 */
export async function checkPayment(bookingId: string): Promise<Booking["paymentStatus"] | null> {
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (!b) return null;
  if (b.paymentStatus !== "pending" || !b.stripeCheckoutSessionId || !b.stripeAccountId) return b.paymentStatus;

  const session = await stripe().checkout.sessions.retrieve(b.stripeCheckoutSessionId, {}, { stripeAccount: b.stripeAccountId });
  if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
    const [paid] = await db
      .update(bookings)
      .set({ paymentStatus: "paid", stripePaymentIntentId: pi, paymentExpiresAt: null })
      .where(and(eq(bookings.id, b.id), eq(bookings.paymentStatus, "pending")))
      .returning();
    if (!paid) return checkPayment(bookingId); // settled concurrently
    if (paid.status !== "confirmed") {
      // Cancelled while they were paying: give the money back rather than leaving them charged.
      await refundBooking(paid);
      return "refunded";
    }
    await enqueue("booking-confirmed", { bookingId: b.id });
    return "paid";
  }

  if (b.paymentExpiresAt && b.paymentExpiresAt.getTime() <= Date.now()) {
    if (session.status === "open") {
      await stripe().checkout.sessions.expire(session.id, {}, { stripeAccount: b.stripeAccountId }).catch(() => {});
    }
    await releaseHold(b.id, "expired");
    return "expired";
  }
  return "pending";
}

/** Give up an unpaid hold: the slot is free again and nothing was sent. */
export async function releaseHold(bookingId: string, reason: "expired" | "abandoned") {
  await db
    .update(bookings)
    .set({ status: "cancelled", cancelledAt: new Date(), paymentStatus: "expired", cancelReason: reason === "expired" ? "Payment not completed in time" : "Payment cancelled" })
    .where(and(eq(bookings.id, bookingId), eq(bookings.paymentStatus, "pending")));
}

/**
 * The invitee backed out of paying (or the booking was cancelled while unpaid): close the Checkout Session and
 * release the hold. If the payment went through after all, the booking is confirmed (or refunded if cancelled).
 */
export async function abandonCheckout(bookingId: string): Promise<Booking["paymentStatus"] | null> {
  const first = await checkPayment(bookingId);
  if (first !== "pending") return first;
  const [b] = await db.select().from(bookings).where(eq(bookings.id, bookingId));
  if (b?.stripeCheckoutSessionId && b.stripeAccountId) {
    await stripe().checkout.sessions.expire(b.stripeCheckoutSessionId, {}, { stripeAccount: b.stripeAccountId }).catch(() => {});
  }
  // Expiring can race with a payment that just completed; settle once more before giving up the slot.
  const last = await checkPayment(bookingId);
  if (last !== "pending") return last;
  await releaseHold(bookingId, "abandoned");
  return "expired";
}

/** Refund a paid booking in full on the host's account. */
export async function refundBooking(b: Booking) {
  if (b.paymentStatus !== "paid" || !b.stripePaymentIntentId || !b.stripeAccountId) return;
  await stripe().refunds.create(
    { payment_intent: b.stripePaymentIntentId, reason: "requested_by_customer", metadata: { slotnestBookingId: b.id } },
    { stripeAccount: b.stripeAccountId, idempotencyKey: `refund:${b.id}` },
  );
  await db.update(bookings).set({ paymentStatus: "refunded" }).where(eq(bookings.id, b.id));
}
