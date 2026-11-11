// The admin page: every account and booking on this server, for the people listed in ADMIN_EMAILS. Read-only.
import { and, desc, eq, gte, ilike, inArray, not, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { bookings, eventTypes, users } from "@/db/schema";
import { config } from "@/lib/config";

type User = typeof users.$inferSelect;

export const isAdmin = (user: Pick<User, "email">) => config.adminEmails.includes(user.email.toLowerCase());

const count = (where: SQL) => sql<number>`count(*) filter (where ${where})::int`;

export async function adminStats() {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const now = new Date();
  const [u] = await db
    .select({
      users: sql<number>`count(*)::int`,
      newThisWeek: count(gte(users.createdAt, weekAgo)),
      paying: count(eq(users.billingStatus, "active")),
      trialing: count(and(eq(users.billingStatus, "trialing"), gte(users.trialEndsAt, now))!),
      free: count(not(or(inArray(users.billingStatus, ["active", "past_due"]), and(eq(users.billingStatus, "trialing"), gte(users.trialEndsAt, now)))!)),
    })
    .from(users);
  const [b] = await db
    .select({
      bookings: count(eq(bookings.status, "confirmed")),
      bookedThisWeek: count(gte(bookings.createdAt, weekAgo)),
      upcoming: count(and(eq(bookings.status, "confirmed"), gte(bookings.startAt, now))!),
      cancelled: count(eq(bookings.status, "cancelled")),
    })
    .from(bookings);
  return { ...u, ...b };
}

const LIMIT = 200;
// Drizzle writes a column without its table in a single-table select, which a subquery would read as its own column.
const userId = sql.raw(`"users"."id"`);

/** Accounts, newest first, optionally matching `q` in name, email or username. */
export async function adminUsers(q?: string) {
  const like = q ? `%${q}%` : null;
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      timeZone: users.timeZone,
      plan: users.plan,
      billingStatus: users.billingStatus,
      trialEndsAt: users.trialEndsAt,
      seats: users.seats,
      bonusSeats: users.bonusSeats,
      suspended: sql<boolean>`${users.suspendedAt} is not null`,
      stripePayouts: users.stripeChargesEnabled,
      createdAt: users.createdAt,
      eventTypes: sql<number>`(select count(*)::int from event_types e where e.user_id = ${userId})`,
      bookings: sql<number>`(select count(*)::int from bookings b where b.host_id = ${userId} and b.status = 'confirmed')`,
      lastBookedAt: sql<Date | null>`(select max(b.created_at) from bookings b where b.host_id = ${userId})`.mapWith(
        (v) => (v ? new Date(v) : null),
      ),
      calendars: sql<string[]>`array(select distinct c.provider::text from calendar_connections c where c.user_id = ${userId})`,
    })
    .from(users)
    .where(like ? or(ilike(users.name, like), ilike(users.email, like), ilike(users.username, like)) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(LIMIT);
}

/** Bookings, most recently made first, optionally matching `q` in the invitee's or host's name or email. */
export async function adminBookings(q?: string) {
  const like = q ? `%${q}%` : null;
  return db
    .select({
      id: bookings.id,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      status: bookings.status,
      inviteeName: bookings.inviteeName,
      inviteeEmail: bookings.inviteeEmail,
      inviteeTimeZone: bookings.inviteeTimeZone,
      paymentStatus: bookings.paymentStatus,
      paymentAmount: bookings.paymentAmount,
      paymentCurrency: bookings.paymentCurrency,
      createdAt: bookings.createdAt,
      title: eventTypes.title,
      hostName: users.name,
      hostEmail: users.email,
      hostTimeZone: users.timeZone,
    })
    .from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .innerJoin(users, eq(users.id, bookings.hostId))
    .where(
      like
        ? or(ilike(bookings.inviteeName, like), ilike(bookings.inviteeEmail, like), ilike(users.name, like), ilike(users.email, like))
        : undefined,
    )
    .orderBy(desc(bookings.createdAt))
    .limit(LIMIT);
}

export const ADMIN_LIMIT = LIMIT;
