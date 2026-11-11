import { config } from "@/lib/config";

/**
 * Plans: everyone starts on Free (one bookable event type, "Powered by Slotnest" shown). Paying (Solo or Team) unlocks
 * the rest: unlimited event types, teams, routing forms, taking payments, webhooks, custom reminder wording and
 * removing the branding. Accounts from before the free plan keep their 14-day trial (everything) until it ends.
 * A cancelled subscription falls back to Free. Billing is only enforced when Stripe is configured; without it,
 * UNBILLED_PAID_FEATURES (default on) decides, so local development can try both.
 */
export type BillingStatus = "free" | "trialing" | "active" | "past_due" | "canceled";

interface BillingFields {
  billingStatus: BillingStatus;
  trialEndsAt: Date;
  /** Suspended by an admin: closed whatever the billing says. */
  suspendedAt?: Date | null;
}

/** How many personal event types take bookings on the Free plan. */
export const FREE_EVENT_TYPES = 1;

/** A trial from before the free plan that hasn't ended yet. */
export const inTrial = (u: BillingFields, now = new Date()) => u.billingStatus === "trialing" && u.trialEndsAt > now;

/**
 * Whether the account's own billing unlocks the paid features: a paid plan (past_due stays paid while Stripe retries
 * the charge) or a trial that is still running. A seat on someone else's Team plan also counts; see hasPaidFeatures.
 */
export function onPaidPlan(u: BillingFields, now = new Date()): boolean {
  if (!config.stripe) return config.unbilledPaidFeatures;
  return u.billingStatus === "active" || u.billingStatus === "past_due" || inTrial(u, now);
}

/** "Free", "Trial", "Solo", "Team": the plan as shown to people. */
export function planName(u: BillingFields & { plan: "solo" | "team" }, now = new Date()): string {
  if (inTrial(u, now)) return "Trial";
  if (u.billingStatus === "active" || u.billingStatus === "past_due") return u.plan === "team" ? "Team" : "Solo";
  return "Free";
}

/** Whether the account's booking pages are open at all: every plan, Free included, unless an admin suspended it. */
export function canAcceptBookings(u: BillingFields): boolean {
  return !u.suspendedAt;
}

/**
 * Whether an account may use team features (create a team, take team bookings): a running trial, or the Team plan.
 * Unenforced without Stripe.
 */
export function teamPlanAllows(u: BillingFields & { plan: "solo" | "team" }, now = new Date()): boolean {
  if (!config.stripe) return true;
  return inTrial(u, now) || (u.plan === "team" && onPaidPlan(u, now));
}

/** Team booking pages follow the team owner's billing: open, and on a plan that includes teams. */
export function canAcceptTeamBookings(owner: BillingFields & { plan: "solo" | "team" }, now = new Date()): boolean {
  return canAcceptBookings(owner) && teamPlanAllows(owner, now);
}

/** How many members the team may have; null = no limit (no Stripe, or still in the trial). Bonus seats are free extras. */
export function seatLimit(owner: BillingFields & { plan: "solo" | "team"; seats: number; bonusSeats?: number }, now = new Date()): number | null {
  if (!config.stripe || inTrial(owner, now)) return null;
  return (owner.plan === "team" ? owner.seats : 1) + (owner.bonusSeats ?? 0);
}
