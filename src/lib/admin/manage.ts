// Admin changes to one account: seats (paid through Stripe, or free bonus seats), plan and trial for accounts that
// don't pay through Stripe, suspension, and the members of the team they own. Every function checks the caller.
import { count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { teamMembers, users } from "@/db/schema";
import { seatLimit } from "@/lib/billing/access";
import { planPrices, stripe } from "@/lib/billing/stripe";
import { config } from "@/lib/config";
import { openInvites, ownedTeam, removeMember, revokeInvite, teamMemberList } from "@/lib/teams";
import { isAdmin } from "./index";

type User = typeof users.$inferSelect;

export class AdminError extends Error {}

export const MAX_SEATS = 500;

function check(admin: User) {
  if (!isAdmin(admin)) throw new AdminError("Not allowed");
}

async function load(userId: string): Promise<User> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new AdminError("Account not found");
  return u;
}

async function membersOf(account: User): Promise<number> {
  const team = await ownedTeam(account.id);
  if (!team) return 0;
  const [m] = await db.select({ n: count() }).from(teamMembers).where(eq(teamMembers.teamId, team.id));
  return m.n;
}

/** Whether the account pays through a live Stripe subscription (then Stripe owns its plan, status and paid seats). */
export const paysThroughStripe = (u: User) => !!u.stripeSubscriptionId && u.billingStatus !== "canceled";

/** Refuse a change that leaves the owner's team with more members than seats. */
async function fitsTeam(next: User) {
  const limit = seatLimit(next);
  const members = await membersOf(next);
  if (limit !== null && members > limit) {
    throw new AdminError(`Their team has ${members} members, which is more than ${limit} seats. Remove members first.`);
  }
}

/** Everything the account page shows. */
export async function getAccount(admin: User, userId: string) {
  check(admin);
  const account = await load(userId);
  const team = await ownedTeam(account.id);
  const [members, invites] = team ? await Promise.all([teamMemberList(team.id), openInvites(team.id)]) : [[], []];
  return { account, team, members, invites, limit: seatLimit(account), stripe: paysThroughStripe(account) };
}

export async function setBonusSeats(admin: User, userId: string, n: number) {
  check(admin);
  if (!Number.isInteger(n) || n < 0 || n > MAX_SEATS) throw new AdminError(`Free seats must be a whole number from 0 to ${MAX_SEATS}`);
  const account = await load(userId);
  await fitsTeam({ ...account, bonusSeats: n });
  await db.update(users).set({ bonusSeats: n }).where(eq(users.id, userId));
}

/**
 * Change the paid seats on a Team subscription. More seats are charged now (the per-seat setup fee plus the prorated
 * yearly fee); fewer seats leave a prorated credit for the next invoice. Stripe's webhook confirms the new count.
 */
export async function setPaidSeats(admin: User, userId: string, n: number) {
  check(admin);
  if (!config.stripe) throw new AdminError("Stripe isn't configured on this server");
  const account = await load(userId);
  if (!paysThroughStripe(account) || account.plan !== "team") throw new AdminError("Only accounts paying for the Team plan through Stripe have paid seats");
  if (!Number.isInteger(n) || n < 2 || n > MAX_SEATS) throw new AdminError(`Paid seats must be a whole number from 2 to ${MAX_SEATS}`);
  if (n === account.seats) return;
  await fitsTeam({ ...account, seats: n });

  const sub = await stripe().subscriptions.retrieve(account.stripeSubscriptionId!);
  const yearly = sub.items.data.find((i) => i.price.recurring);
  if (!yearly) throw new AdminError("Their Stripe subscription has no yearly item");
  const more = n - (yearly.quantity ?? account.seats);
  await stripe().subscriptions.update(sub.id, {
    items: [{ id: yearly.id, quantity: n }],
    metadata: { ...sub.metadata, seats: String(n) },
    ...(more > 0
      ? { add_invoice_items: [{ price: planPrices("team").setup, quantity: more }], proration_behavior: "always_invoice" as const }
      : { proration_behavior: "create_prorations" as const }),
  });
  await db.update(users).set({ seats: n }).where(eq(users.id, userId));
}

export type BillingChoice = { plan: "solo" | "team"; status: "trial"; trialEndsAt: Date } | { plan: "solo" | "team"; status: "comped" | "free" };

/** Plan and status for an account that doesn't pay through Stripe: a trial until a date, paid outside Stripe (comped), or Free. */
export async function setPlanAndBilling(admin: User, userId: string, choice: BillingChoice) {
  check(admin);
  const account = await load(userId);
  if (paysThroughStripe(account)) throw new AdminError("This account pays through Stripe, so its plan and status follow the subscription");
  const set: Partial<User> =
    choice.status === "trial"
      ? { plan: choice.plan, billingStatus: "trialing", trialEndsAt: choice.trialEndsAt }
      : { plan: choice.plan, billingStatus: choice.status === "comped" ? "active" : "free" };
  if (choice.status === "trial" && !(choice.trialEndsAt.getTime() > 0)) throw new AdminError("Pick a trial end date");
  await fitsTeam({ ...account, ...set });
  await db.update(users).set(set).where(eq(users.id, userId));
}

export async function setSuspended(admin: User, userId: string, suspended: boolean) {
  check(admin);
  await load(userId);
  await db.update(users).set({ suspendedAt: suspended ? new Date() : null }).where(eq(users.id, userId));
}

async function teamOf(ownerId: string) {
  const team = await ownedTeam(ownerId);
  if (!team) throw new AdminError("This account doesn't own a team");
  return team;
}

export async function removeTeamMember(admin: User, ownerId: string, memberId: string) {
  check(admin);
  const team = await teamOf(ownerId);
  if (memberId === team.ownerId) throw new AdminError("The owner can't be removed from their team");
  await removeMember(team, memberId);
}

export async function revokeTeamInvite(admin: User, ownerId: string, inviteId: string) {
  check(admin);
  await revokeInvite(await teamOf(ownerId), inviteId);
}
