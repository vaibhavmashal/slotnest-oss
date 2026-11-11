// Teams: membership, invites, seats, and the public identity (handle, name, branding) of team event types.
import { and, asc, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { eventTypeHosts, eventTypes, teamInvites, teamMembers, teams, users } from "@/db/schema";
import { canAcceptBookings, FREE_EVENT_TYPES, onPaidPlan, seatLimit, teamPlanAllows } from "@/lib/billing/access";
import { getBranding, type Branding } from "@/lib/branding";
import { config } from "@/lib/config";
import { newToken, sha256 } from "@/lib/crypto";
import { sendEmail } from "@/lib/email/send";
import { render } from "@/lib/email/templates";

type User = typeof users.$inferSelect;
export type Team = typeof teams.$inferSelect;
type EventType = typeof eventTypes.$inferSelect;

export class TeamError extends Error {
  constructor(
    public code: "TAKEN" | "OWNS_TEAM" | "NAME" | "SLUG" | "EMAIL" | "MEMBER" | "FORBIDDEN" | "SEATS" | "PLAN" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
  }
}

/** Usernames and team slugs share this format and one namespace (the `handles` table). */
export const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
const INVITE_DAYS = 7;

/** Top-level app routes and names we keep; a handle with one of these would be shadowed or misleading. */
const RESERVED_HANDLES = new Set([
  "api", "app", "assets", "auth", "b", "dashboard", "invite", "login", "logout", "onboarding", "privacy", "terms",
  "admin", "billing", "embed", "help", "pricing", "settings", "signup", "slotnest", "support", "www",
]);

/** "AT20 Sales " → "at20-sales": what people type into a link field, made into a handle (still checked with HANDLE_RE). */
export function toHandle(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

export async function handleTaken(handle: string): Promise<boolean> {
  if (RESERVED_HANDLES.has(handle)) return true;
  const rows = await db.execute<{ one: number }>(sql`SELECT 1 AS one FROM handles WHERE handle = ${handle}`);
  return rows.length > 0;
}

function uniqueViolation(err: unknown): string | null {
  for (let e: any = err; e; e = e.cause) if (e.code === "23505") return String(e.constraint_name ?? e.constraint ?? "");
  return null;
}

export async function createTeam(owner: User, name: string, slug: string): Promise<Team> {
  if (!teamPlanAllows(owner)) throw new TeamError("PLAN", "Teams are part of the Team plan");
  if (!name.trim()) throw new TeamError("NAME", "Please enter a team name");
  if (!HANDLE_RE.test(slug)) throw new TeamError("SLUG", "Team links are 2–39 characters: lowercase letters, numbers and hyphens");
  if (RESERVED_HANDLES.has(slug)) throw new TeamError("TAKEN", "That link is taken");
  try {
    return await db.transaction(async (tx) => {
      const [team] = await tx.insert(teams).values({ name: name.trim().slice(0, 100), slug, ownerId: owner.id }).returning();
      await tx.insert(teamMembers).values({ teamId: team.id, userId: owner.id, role: "owner" });
      return team;
    });
  } catch (err) {
    const c = uniqueViolation(err);
    if (c === "teams_owner_id_key") throw new TeamError("OWNS_TEAM", "You already own a team");
    if (c !== null) throw new TeamError("TAKEN", "That link is taken");
    throw err;
  }
}

export async function teamsForUser(userId: string) {
  return db
    .select({ team: teams, role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teams.name));
}

export async function ownedTeam(userId: string): Promise<Team | null> {
  const [t] = await db.select().from(teams).where(eq(teams.ownerId, userId));
  return t ?? null;
}

export async function teamMemberList(teamId: string) {
  return db
    .select({ user: users, role: teamMembers.role, joinedAt: teamMembers.createdAt })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(teamMembers.createdAt));
}

export async function openInvites(teamId: string) {
  return db
    .select()
    .from(teamInvites)
    .where(and(eq(teamInvites.teamId, teamId), isNull(teamInvites.acceptedAt), gt(teamInvites.expiresAt, new Date())))
    .orderBy(asc(teamInvites.createdAt));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Members plus (optionally) open invites, counted under a row lock on the team so seat checks can't race. */
async function seatsInUse(tx: Tx, teamId: string, includeInvites: boolean): Promise<number> {
  await tx.execute(sql`SELECT 1 FROM teams WHERE id = ${teamId} FOR UPDATE`);
  const [m] = await tx.select({ n: count() }).from(teamMembers).where(eq(teamMembers.teamId, teamId));
  if (!includeInvites) return m.n;
  const [i] = await tx
    .select({ n: count() })
    .from(teamInvites)
    .where(and(eq(teamInvites.teamId, teamId), isNull(teamInvites.acceptedAt), gt(teamInvites.expiresAt, new Date())));
  return m.n + i.n;
}

async function ownerOf(team: Team): Promise<User> {
  const [o] = await db.select().from(users).where(eq(users.id, team.ownerId));
  return o;
}

export async function inviteMember(team: Team, inviter: User, rawEmail: string): Promise<void> {
  if (team.ownerId !== inviter.id) throw new TeamError("FORBIDDEN", "Only the team owner can invite members");
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw new TeamError("EMAIL", "Please enter a valid email address");
  const [already] = await db
    .select({ id: users.id })
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, team.id), eq(users.email, email)));
  if (already) throw new TeamError("MEMBER", "That person is already on the team");

  const limit = seatLimit(await ownerOf(team));
  const token = newToken();
  await db.transaction(async (tx) => {
    // Re-inviting replaces the earlier open invite (and its link).
    await tx.delete(teamInvites).where(and(eq(teamInvites.teamId, team.id), eq(teamInvites.email, email), isNull(teamInvites.acceptedAt)));
    if (limit !== null && (await seatsInUse(tx, team.id, true)) >= limit) {
      throw new TeamError("SEATS", `All ${limit} seats are in use. Add seats on the Billing page.`);
    }
    await tx.insert(teamInvites).values({
      teamId: team.id,
      email,
      tokenHash: sha256(token),
      invitedBy: inviter.id,
      expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
    });
  });
  await sendEmail({
    to: email,
    subject: `${inviter.name} invited you to ${team.name} on Slotnest`,
    ...render({
      heading: `Join ${team.name} on Slotnest`,
      lines: [
        `${inviter.name} invited you to take bookings for ${team.name}.`,
        `The link works for ${INVITE_DAYS} days. You'll sign in (or create a free account) with this email address.`,
      ],
      link: { label: "Accept invite", url: `${config.appUrl}/invite/${token}` },
    }),
  });
}

export async function revokeInvite(team: Team, inviteId: string): Promise<void> {
  await db.delete(teamInvites).where(and(eq(teamInvites.id, inviteId), eq(teamInvites.teamId, team.id), isNull(teamInvites.acceptedAt)));
}

/** An open, unexpired invite and its team, or null. */
export async function getInvite(token: string) {
  const [row] = await db
    .select({ invite: teamInvites, team: teams })
    .from(teamInvites)
    .innerJoin(teams, eq(teams.id, teamInvites.teamId))
    .where(and(eq(teamInvites.tokenHash, sha256(token)), isNull(teamInvites.acceptedAt), gt(teamInvites.expiresAt, new Date())));
  return row ?? null;
}

export async function acceptInvite(token: string, user: User): Promise<Team> {
  const row = await getInvite(token);
  if (!row) throw new TeamError("NOT_FOUND", "This invite has expired or was already used");
  if (row.invite.email !== user.email) throw new TeamError("FORBIDDEN", `This invite is for ${row.invite.email}`);
  const limit = seatLimit(await ownerOf(row.team));
  await db.transaction(async (tx) => {
    if (limit !== null && (await seatsInUse(tx, row.team.id, false)) >= limit) {
      throw new TeamError("SEATS", "The team has no free seats. Ask the owner to add one.");
    }
    await tx.insert(teamMembers).values({ teamId: row.team.id, userId: user.id }).onConflictDoNothing();
    await tx.update(teamInvites).set({ acceptedAt: new Date() }).where(eq(teamInvites.id, row.invite.id));
  });
  return row.team;
}

/** Remove a member (owner removing someone, or a member leaving). Their existing bookings stay theirs. */
export async function removeMember(team: Team, userId: string): Promise<void> {
  if (userId === team.ownerId) throw new TeamError("FORBIDDEN", "The owner can't leave the team");
  await db.transaction(async (tx) => {
    const teamEvents = tx.select({ id: eventTypes.id }).from(eventTypes).where(eq(eventTypes.teamId, team.id));
    await tx.delete(eventTypeHosts).where(and(eq(eventTypeHosts.userId, userId), inArray(eventTypeHosts.eventTypeId, teamEvents)));
    await tx.delete(teamMembers).where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, userId)));
  });
}

/** A member's seat on a paid Team plan also covers their personal booking pages. */
export async function coveredByTeamSeat(userId: string): Promise<boolean> {
  const rows = await db.execute<{ one: number }>(sql`
    SELECT 1 AS one FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    JOIN users o ON o.id = t.owner_id
    WHERE tm.user_id = ${userId} AND o.plan = 'team' AND o.billing_status IN ('active', 'past_due') AND o.suspended_at IS NULL
    LIMIT 1`);
  return rows.length > 0;
}

/** Whether a user's personal booking pages are open: every plan, Free included, unless an admin suspended them. */
export async function acceptsBookings(user: User): Promise<boolean> {
  return canAcceptBookings(user);
}

/** Whether the paid features are unlocked for a user: their own plan or trial, or a seat on a paid Team plan. */
export async function hasPaidFeatures(user: User): Promise<boolean> {
  return onPaidPlan(user) || (await coveredByTeamSeat(user.id));
}

/**
 * The personal event types that take bookings on the Free plan: the oldest active ones, up to FREE_EVENT_TYPES.
 * Others stay saved (and come back on upgrading) but aren't listed or bookable.
 */
export async function freeEventTypeIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: eventTypes.id })
    .from(eventTypes)
    .where(and(eq(eventTypes.userId, userId), isNull(eventTypes.teamId), eq(eventTypes.isActive, true)))
    .orderBy(asc(eventTypes.createdAt), asc(eventTypes.id))
    .limit(FREE_EVENT_TYPES);
  return rows.map((r) => r.id);
}

/** The user's personal event types that can take bookings now: all of them on a paid plan, else the Free allowance. */
export async function bookableEventTypeIds(user: User): Promise<Set<string> | "all"> {
  return (await hasPaidFeatures(user)) ? "all" : new Set(await freeEventTypeIds(user.id));
}

// ---- Public identity of an event type ----

export interface EventContext {
  /** URL handle: the username, or the team slug. */
  handle: string;
  /** Name shown to invitees: the host, or the team. */
  displayName: string;
  /** Whose billing and branding apply: the host, or the team owner. */
  account: User;
  team: Team | null;
}

export async function eventContext(eventType: EventType, host: User): Promise<EventContext> {
  if (!eventType.teamId) return { handle: host.username, displayName: host.name, account: host, team: null };
  const [row] = await db.select({ team: teams, owner: users }).from(teams).innerJoin(users, eq(users.id, teams.ownerId)).where(eq(teams.id, eventType.teamId));
  return { handle: row.team.slug, displayName: row.team.name, account: row.owner, team: row.team };
}

/** Team pages use the owner's logo and colour under the team's name; a personal profile photo would mislead. */
export async function contextBranding(ctx: EventContext): Promise<Branding> {
  const b = await getBranding(ctx.account);
  return ctx.team ? { ...b, name: ctx.team.name, avatar: null } : b;
}

/** "Ann", "Ann and Bo", "Ann, Bo and Cy": the people an invitee meets. */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export const publicUrl = (ctx: EventContext, eventType: Pick<EventType, "slug">) => `${config.appUrl}/${ctx.handle}/${eventType.slug}`;
