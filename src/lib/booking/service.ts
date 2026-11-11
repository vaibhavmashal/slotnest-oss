import { and, asc, eq, gt, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { randomBytes } from "node:crypto";
import { db, type Db } from "@/db/client";
import { availabilityRules, bookingHosts, bookings, dateOverrides, eventTypeHosts, eventTypes, schedules, teams, users } from "@/db/schema";
import { computeSlots, intersectSlots, isSlotAvailable, mergeSlots, SHARED_GRID_MINUTES, thinSlots, type AvailabilityInput, type BusyBlock, type DateOverride, type Slot, type Weekday } from "@/lib/availability/engine";
import { canAcceptTeamBookings } from "@/lib/billing/access";
import { encrypt, newToken, safeEqualHex, sha256 } from "@/lib/crypto";
import { getExternalBusy, type Busy } from "@/lib/integrations/calendar";
import { enqueue } from "@/lib/jobs/queue";
import { HOLD_MINUTES, paymentsAvailable, releaseHold, startCheckout } from "@/lib/payments";
import { AnswerError, checkAnswers } from "./questions";
import { acceptsBookings, bookableEventTypeIds, eventContext, freeEventTypeIds, hasPaidFeatures, type EventContext } from "@/lib/teams";
import { pickHost, ROUND_ROBIN_WINDOW_DAYS } from "@/lib/teams/round-robin";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Conn = Db | Tx;

export class BookingError extends Error {
  constructor(
    public code: "NOT_FOUND" | "SLOT_UNAVAILABLE" | "INVALID" | "FORBIDDEN" | "NOT_ACCEPTING",
    message: string,
  ) {
    super(message);
  }
}

type User = typeof users.$inferSelect;
type EventType = typeof eventTypes.$inferSelect;

export interface PublicEvent {
  eventType: EventType;
  /** Handle, display name, and the account whose billing and branding apply. */
  context: EventContext;
  /** The host, or the team members assigned to the event type (round-robin: one of them; collective: all of them). */
  hosts: User[];
}

/** Resolve /{handle}/{slug}: a user's personal event type, or a team's round-robin or collective event type. */
export async function getPublicEvent(handle: string, slug: string): Promise<PublicEvent | null> {
  const [personal] = await db
    .select({ eventType: eventTypes, host: users })
    .from(eventTypes)
    .innerJoin(users, eq(users.id, eventTypes.userId))
    .where(and(eq(users.username, handle), eq(eventTypes.slug, slug), isNull(eventTypes.teamId), eq(eventTypes.isActive, true)));
  if (personal) {
    const { eventType, host } = personal;
    return { eventType, context: await eventContext(eventType, host), hosts: [host] };
  }
  const [team] = await db
    .select({ eventType: eventTypes, team: teams, owner: users })
    .from(eventTypes)
    .innerJoin(teams, eq(teams.id, eventTypes.teamId))
    .innerJoin(users, eq(users.id, teams.ownerId))
    .where(and(eq(teams.slug, handle), eq(eventTypes.slug, slug), eq(eventTypes.isActive, true)));
  if (!team) return null;
  const hosts = await db
    .select({ user: users })
    .from(eventTypeHosts)
    .innerJoin(users, eq(users.id, eventTypeHosts.userId))
    .where(eq(eventTypeHosts.eventTypeId, team.eventType.id))
    .orderBy(asc(users.id));
  return {
    eventType: team.eventType,
    context: { handle: team.team.slug, displayName: team.team.name, account: team.owner, team: team.team },
    hosts: hosts.map((h) => h.user),
  };
}

/**
 * The public profile at /{handle}: a user's or team's active event types that aren't hidden.
 * Null when the handle doesn't exist.
 */
export async function getPublicProfile(handle: string): Promise<{ context: EventContext; eventTypes: EventType[] } | null> {
  const listed = and(eq(eventTypes.isActive, true), eq(eventTypes.isHidden, false));
  const [user] = await db.select().from(users).where(eq(users.username, handle));
  if (user) {
    const rows = await db.select().from(eventTypes).where(and(eq(eventTypes.userId, user.id), isNull(eventTypes.teamId), listed)).orderBy(asc(eventTypes.createdAt));
    // Free plan: only the event type that takes bookings is listed.
    const bookable = await bookableEventTypeIds(user);
    const shown = bookable === "all" ? rows : rows.filter((e) => bookable.has(e.id) && !e.priceAmount);
    return { context: { handle, displayName: user.name, account: user, team: null }, eventTypes: shown };
  }
  const [team] = await db.select({ team: teams, owner: users }).from(teams).innerJoin(users, eq(users.id, teams.ownerId)).where(eq(teams.slug, handle));
  if (!team) return null;
  const rows = await db.select().from(eventTypes).where(and(eq(eventTypes.teamId, team.team.id), listed)).orderBy(asc(eventTypes.createdAt));
  return { context: { handle, displayName: team.team.name, account: team.owner, team: team.team }, eventTypes: rows };
}

/**
 * Whether this event type takes bookings. Team event types need the owner's Team plan. Personal ones are open on every
 * plan, but on Free only the allowed event type is bookable, and taking payments needs a paid plan.
 */
export async function isAccepting(event: PublicEvent): Promise<boolean> {
  const account = event.context.account;
  if (event.context.team) return canAcceptTeamBookings(account);
  if (!(await acceptsBookings(account))) return false;
  if (await hasPaidFeatures(account)) return true;
  if (event.eventType.priceAmount) return false;
  return (await freeEventTypeIds(account.id)).includes(event.eventType.id);
}

/** External calendar busy times for the padded range used by buildAvailabilityInput. */
function fetchExternalBusy(hostId: string, from: DateTime, to: DateTime): Promise<Busy[]> {
  return getExternalBusy(hostId, from.minus({ days: 1 }).toISO()!, to.plus({ days: 1 }).toISO()!);
}

/**
 * Gather everything the engine needs for one event type over [from, to).
 * External busy times are fetched by the caller *before* any transaction: provider calls are slow, and
 * they use their own pool connection, which would deadlock the pool if made while holding the host lock.
 */
async function buildAvailabilityInput(
  conn: Conn,
  eventType: EventType,
  host: User,
  from: DateTime,
  to: DateTime,
  externalBusy: Busy[],
  excludeBookingId?: string,
): Promise<AvailabilityInput | null> {
  // Personal event types have their own schedule; team event types use each host's default schedule.
  const [scheduleRow] = await conn
    .select()
    .from(schedules)
    .where(eventType.scheduleId ? eq(schedules.id, eventType.scheduleId) : and(eq(schedules.userId, host.id), eq(schedules.isDefault, true)));
  if (!scheduleRow) return null;
  const rules = await conn.select().from(availabilityRules).where(eq(availabilityRules.scheduleId, scheduleRow.id));
  const overrideRows = await conn.select().from(dateOverrides).where(eq(dateOverrides.scheduleId, scheduleRow.id));

  const overrides = new Map<string, DateOverride>();
  for (const o of overrideRows) {
    const entry = overrides.get(o.date) ?? { date: o.date, windows: [] };
    if (o.startMinute !== null && o.endMinute !== null) entry.windows.push({ startMinute: o.startMinute, endMinute: o.endMinute });
    overrides.set(o.date, entry);
  }

  // Busy = every confirmed meeting this host is in (organizer or collective member), padded by a day so buffers and
  // daily caps see neighbours, + external calendars.
  const padFrom = from.minus({ days: 1 });
  const padTo = to.plus({ days: 1 });
  const rows = await conn
    .select({ startAt: bookingHosts.startAt, endAt: bookingHosts.endAt, sessionKey: bookingHosts.sessionKey })
    .from(bookingHosts)
    .where(
      and(
        eq(bookingHosts.hostId, host.id),
        eq(bookingHosts.status, "confirmed"),
        lt(bookingHosts.startAt, padTo.toJSDate()),
        gt(bookingHosts.endAt, padFrom.toJSDate()),
        excludeBookingId ? ne(bookingHosts.bookingId, excludeBookingId) : undefined,
      ),
    );
  // A group session with several invitees is one meeting for the host (one busy block, one toward the daily cap).
  const sessions = new Set<string>();
  const existing = rows.filter((b) => !b.sessionKey || (!sessions.has(b.sessionKey) && !!sessions.add(b.sessionKey)));
  let external = externalBusy;
  if (excludeBookingId) {
    // When rescheduling, the booking's own event on the host calendar must not block its new time.
    const [self] = await conn.select({ startAt: bookings.startAt, endAt: bookings.endAt }).from(bookings).where(eq(bookings.id, excludeBookingId));
    if (self) {
      const s = self.startAt.getTime();
      const e = self.endAt.getTime();
      external = external.filter((b) => !(Date.parse(b.start) === s && Date.parse(b.end) === e));
    }
  }
  // Events we wrote to the host's calendar are already represented by our own bookings.
  const ours = new Set(existing.map((b) => `${b.startAt.getTime()}-${b.endAt.getTime()}`));
  external = external.filter((b) => !ours.has(`${Date.parse(b.start)}-${Date.parse(b.end)}`));

  const busy: BusyBlock[] = [
    ...existing.map((b) => ({ start: b.startAt.toISOString(), end: b.endAt.toISOString(), source: "booking" as const })),
    ...external.map((b) => ({ ...b, source: "calendar" as const })),
  ];

  return {
    hostTimeZone: scheduleRow.timeZone,
    weeklyRules: rules.map((r) => ({ weekday: r.weekday as Weekday, startMinute: r.startMinute, endMinute: r.endMinute })),
    dateOverrides: [...overrides.values()],
    durationMinutes: eventType.durationMinutes,
    slotIntervalMinutes: eventType.slotIntervalMinutes ?? undefined,
    bufferBeforeMinutes: eventType.bufferBeforeMinutes,
    bufferAfterMinutes: eventType.bufferAfterMinutes,
    minimumNoticeMinutes: eventType.minimumNoticeMinutes,
    bookingWindowDays: eventType.bookingWindowDays,
    maxPerDay: eventType.maxPerDay ?? undefined,
    busy,
    rangeStart: from.toUTC().toISO()!,
    rangeEnd: to.toUTC().toISO()!,
    now: DateTime.utc().toISO()!,
  };
}

const MAX_RANGE_DAYS = 62;

function parseRange(fromIso: string, toIso: string) {
  const from = DateTime.fromISO(fromIso, { zone: "utc" });
  const to = DateTime.fromISO(toIso, { zone: "utc" });
  if (!from.isValid || !to.isValid || to <= from || to.diff(from, "days").days > MAX_RANGE_DAYS) {
    throw new BookingError("INVALID", "Invalid range");
  }
  return [from, to] as const;
}

/** When several hosts must all be free, their slots are computed on a common fine grid (see intersectSlots). */
const onSharedGrid = (input: AvailabilityInput | null, shared: boolean) =>
  input && shared ? { ...input, slotIntervalMinutes: SHARED_GRID_MINUTES } : input;

/** Slots for one host (empty if the host has no schedule). */
async function hostSlots(eventType: EventType, host: User, from: DateTime, to: DateTime, shared: boolean, excludeBookingId?: string) {
  const external = await fetchExternalBusy(host.id, from, to);
  const input = onSharedGrid(await buildAvailabilityInput(db, eventType, host, from, to, external, excludeBookingId), shared);
  return input ? computeSlots(input) : [];
}

/**
 * Bookable slots for /{handle}/{slug}.
 * - Round-robin: the union of the hosts' slots (any one of them can take it).
 * - Collective: the intersection (all of them must be free).
 * - Rescheduling: the booking keeps its hosts, so the intersection of just those hosts, and the booking itself
 *   doesn't block its new time.
 */
export async function getSlots(
  handle: string,
  slug: string,
  fromIso: string,
  toIso: string,
  reschedule?: { bookingId: string; hosts: User[] },
) {
  const event = await getPublicEvent(handle, slug);
  if (!event) throw new BookingError("NOT_FOUND", "Event type not found");
  if (!(await isAccepting(event))) return [];
  const [from, to] = parseRange(fromIso, toIso);
  const hosts = reschedule ? reschedule.hosts : event.hosts;
  const shared = hosts.length > 1 && (!!reschedule || event.eventType.scheduling === "collective");
  const lists = await Promise.all(hosts.map((h) => hostSlots(event.eventType, h, from, to, shared, reschedule?.bookingId)));
  if (shared) return thinSlots(intersectSlots(lists), event.eventType.slotIntervalMinutes ?? event.eventType.durationMinutes);
  const merged = mergeSlots(lists); // personal, round-robin, or a single-host reschedule
  if (!isGroup(event.eventType)) return merged;
  return withOpenSessions(event.eventType, merged, from, to, reschedule?.bookingId);
}

// ---- Group events ------------------------------------------------------------------------------

export const isGroup = (e: Pick<EventType, "seatsPerSlot" | "teamId">) => e.seatsPerSlot > 1 && !e.teamId;

/** The key shared by every booking in one slot of a group event type. */
export const sessionKey = (eventTypeId: string, start: DateTime | Date) =>
  `${eventTypeId}:${(start instanceof Date ? DateTime.fromJSDate(start) : start).toUTC().toISO()}`;

/** Confirmed bookings per started session of a group event type in [from, to), optionally not counting one booking. */
async function sessionCounts(conn: Conn, eventTypeId: string, from: Date, to: Date, excludeBookingId?: string) {
  const rows = await conn
    .select({ startAt: bookings.startAt, n: sql<number>`count(*)`.mapWith(Number) })
    .from(bookings)
    .where(
      and(
        eq(bookings.eventTypeId, eventTypeId),
        eq(bookings.status, "confirmed"),
        sql`${bookings.sessionKey} IS NOT NULL`,
        gte(bookings.startAt, from),
        lt(bookings.startAt, to),
        excludeBookingId ? ne(bookings.id, excludeBookingId) : undefined,
      ),
    )
    .groupBy(bookings.startAt);
  return new Map(rows.map((r) => [r.startAt.getTime(), r.n]));
}

/**
 * A group event's slots: free times (new sessions, all seats open) plus sessions that already have invitees but
 * still have seats. Those stay bookable even though the host is "busy" then, as long as they respect the notice.
 */
async function withOpenSessions(eventType: EventType, free: Slot[], from: DateTime, to: DateTime, excludeBookingId?: string): Promise<Slot[]> {
  const seats = eventType.seatsPerSlot;
  const counts = await sessionCounts(db, eventType.id, from.toJSDate(), to.toJSDate(), excludeBookingId);
  const earliest = DateTime.utc().plus({ minutes: eventType.minimumNoticeMinutes }).toMillis();
  const latest = DateTime.utc().plus({ days: eventType.bookingWindowDays }).toMillis();
  const byStart = new Map<number, Slot>(free.map((s) => [Date.parse(s.start), { ...s, seatsLeft: seats - (counts.get(Date.parse(s.start)) ?? 0) }]));
  for (const [start, n] of counts) {
    if (n >= seats || start < earliest || start >= latest || byStart.has(start)) continue;
    const s = DateTime.fromMillis(start, { zone: "utc" });
    byStart.set(start, { start: s.toISO()!, end: s.plus({ minutes: eventType.durationMinutes }).toISO()!, seatsLeft: seats - n });
  }
  return [...byStart.values()].filter((s) => s.seatsLeft! > 0).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * Inside the booking transaction (host locked): whether `start` can take one more invitee of a group event.
 * An open session can always be joined; a new session needs the host to be free like any booking.
 */
async function groupSeatCheck(tx: Tx, eventType: EventType, start: DateTime, excludeBookingId?: string): Promise<"join" | "new"> {
  const counts = await sessionCounts(tx, eventType.id, start.toJSDate(), start.plus({ milliseconds: 1 }).toJSDate(), excludeBookingId);
  const n = counts.get(start.toMillis()) ?? 0;
  if (n >= eventType.seatsPerSlot) throw new BookingError("SLOT_UNAVAILABLE", "That time is full");
  if (n > 0 && start.toMillis() < DateTime.utc().plus({ minutes: eventType.minimumNoticeMinutes }).toMillis()) {
    throw new BookingError("SLOT_UNAVAILABLE", "That time is no longer available");
  }
  return n > 0 ? "join" : "new";
}

export interface CreateBookingInput {
  /** Username or team slug. */
  handle: string;
  slug: string;
  start: string;
  inviteeName: string;
  inviteeEmail: string;
  inviteeTimeZone: string;
  notes?: string;
  /** Answers to the event type's questions, by question id. */
  answers?: Record<string, string>;
}

const PG_EXCLUSION_VIOLATION = "23P01";

function parseStart(start: string) {
  const dt = DateTime.fromISO(start, { zone: "utc" });
  if (!dt.isValid) throw new BookingError("INVALID", "Invalid start time");
  return dt;
}

/** Serialize booking writes per host so buffer and daily-cap checks can't race. */
async function lockHost(tx: Tx, hostId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`booking:${hostId}`}))`);
}

async function translateConflicts<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (findPgCode(err) === PG_EXCLUSION_VIOLATION) throw new BookingError("SLOT_UNAVAILABLE", "That time is no longer available");
    throw err;
  }
}

/** Equal distribution among the free hosts (see lib/teams/round-robin). Runs inside the booking transaction. */
async function chooseRoundRobinHost(tx: Tx, eventTypeId: string, free: User[]): Promise<User> {
  if (free.length === 1) return free[0];
  const since = DateTime.utc().minus({ days: ROUND_ROBIN_WINDOW_DAYS }).toJSDate();
  const ids = free.map((h) => h.id);
  const stats = await tx
    .select({
      hostId: bookings.hostId,
      recentCount: sql<number>`count(*) FILTER (WHERE ${and(eq(bookings.status, "confirmed"), gt(bookings.createdAt, since))})`.mapWith(Number),
      lastAssignedAt: sql<Date>`max(${bookings.createdAt})`.mapWith((v) => new Date(v)),
    })
    .from(bookings)
    .where(and(eq(bookings.eventTypeId, eventTypeId), inArray(bookings.hostId, ids)))
    .groupBy(bookings.hostId);
  const byHost = new Map(stats.map((s) => [s.hostId, s]));
  const chosen = pickHost(ids.map((id) => byHost.get(id) ?? { hostId: id, recentCount: 0, lastAssignedAt: null }));
  return free.find((h) => h.id === chosen)!;
}

export async function createBooking(input: CreateBookingInput) {
  const event = await getPublicEvent(input.handle, input.slug);
  if (!event) throw new BookingError("NOT_FOUND", "Event type not found");
  if (!(await isAccepting(event))) throw new BookingError("NOT_ACCEPTING", "This page is not accepting bookings right now");
  if (event.hosts.length === 0) throw new BookingError("SLOT_UNAVAILABLE", "That time is no longer available");
  const start = parseStart(input.start);
  if (!DateTime.now().setZone(input.inviteeTimeZone).isValid) throw new BookingError("INVALID", "Invalid time zone");
  const end = start.plus({ minutes: event.eventType.durationMinutes });
  let answers;
  try {
    answers = checkAnswers(event.eventType.questions, input.answers);
  } catch (err) {
    if (err instanceof AnswerError) throw new BookingError("INVALID", err.message);
    throw err;
  }
  // Paid event types: the money goes to the account owner's connected Stripe account.
  const payee = event.context.account;
  const price = event.eventType.priceAmount && event.eventType.priceCurrency ? { amount: event.eventType.priceAmount, currency: event.eventType.priceCurrency } : null;
  if (price && (!paymentsAvailable() || !payee.stripeAccountId || !payee.stripeChargesEnabled)) {
    throw new BookingError("NOT_ACCEPTING", "This page can't take payments right now. Please contact the host.");
  }

  const manageToken = newToken();
  const [from, to] = [start.minus({ days: 1 }), start.plus({ days: 1 })];
  const external = await Promise.all(event.hosts.map((h) => fetchExternalBusy(h.id, from, to)));
  const { booking, hosts } = await translateConflicts(() =>
    db.transaction(async (tx) => {
      // Hosts are locked in id order (event.hosts is sorted), so overlapping round-robin teams can't deadlock.
      for (const h of event.hosts) await lockHost(tx, h.id);
      const collective = event.eventType.scheduling === "collective";
      const shared = collective && event.hosts.length > 1;
      const group = isGroup(event.eventType);
      const joining = group && (await groupSeatCheck(tx, event.eventType, start)) === "join";
      const free: User[] = [];
      for (const [i, h] of event.hosts.entries()) {
        if (joining) {
          free.push(h); // the host already holds this session
          continue;
        }
        const availability = onSharedGrid(await buildAvailabilityInput(tx, event.eventType, h, from, to, external[i]), shared);
        if (availability && isSlotAvailable(availability, start.toISO()!)) free.push(h);
      }
      if (free.length === 0 || (collective && free.length < event.hosts.length)) {
        throw new BookingError("SLOT_UNAVAILABLE", "That time is no longer available");
      }
      // Collective: the team owner organizes if they're one of the hosts; otherwise the first host does.
      const host = collective
        ? (free.find((h) => h.id === event.context.account.id) ?? free[0])
        : await chooseRoundRobinHost(tx, event.eventType.id, free);
      const [row] = await tx
        .insert(bookings)
        .values({
          eventTypeId: event.eventType.id,
          hostId: host.id,
          icalUid: `${randomBytes(16).toString("hex")}@slotnest`,
          startAt: start.toJSDate(),
          endAt: end.toJSDate(),
          inviteeName: input.inviteeName,
          inviteeEmail: input.inviteeEmail.trim().toLowerCase(),
          inviteeTimeZone: input.inviteeTimeZone,
          notes: input.notes,
          answers,
          sessionKey: group ? sessionKey(event.eventType.id, start) : null,
          ...(price && {
            paymentStatus: "pending" as const,
            paymentAmount: price.amount,
            paymentCurrency: price.currency,
            paymentExpiresAt: DateTime.utc().plus({ minutes: HOLD_MINUTES }).toJSDate(),
            stripeAccountId: payee.stripeAccountId,
          }),
          manageTokenHash: sha256(manageToken),
          manageTokenEnc: encrypt(manageToken),
        })
        .returning();
      // The organizer's booking_hosts row comes from a trigger; collective events add the other hosts.
      const others = collective ? free.filter((h) => h.id !== host.id) : [];
      if (others.length) {
        await tx
          .insert(bookingHosts)
          .values(others.map((h) => ({ bookingId: row.id, hostId: h.id, startAt: row.startAt, endAt: row.endAt, status: row.status })));
      }
      return { booking: row, hosts: [host, ...others] };
    }),
  );
  if (price) {
    // Hold the slot and send the invitee to Stripe Checkout; confirmation happens once they've paid.
    try {
      const checkoutUrl = await startCheckout(booking, {
        title: event.eventType.title,
        hostName: event.context.displayName,
        when: `${start.setZone(input.inviteeTimeZone).toFormat("cccc d LLLL yyyy, HH:mm")} (${input.inviteeTimeZone})`,
        manageToken,
      });
      return { booking, host: hosts[0], hosts, manageToken, eventType: event.eventType, checkoutUrl };
    } catch (err) {
      await releaseHold(booking.id, "abandoned");
      console.error("[payments] checkout failed", err);
      throw new BookingError("NOT_ACCEPTING", "Payment couldn't be started. Please try again.");
    }
  }
  // Calendar events, video link, emails and reminders run as a retried background job.
  await enqueue("booking-confirmed", { bookingId: booking.id });
  return { booking, host: hosts[0], hosts, manageToken, eventType: event.eventType, checkoutUrl: null as string | null };
}

/** Everyone hosting a booking, organizer first. */
export async function hostsOfBooking(conn: Conn, bookingId: string, organizerId: string): Promise<User[]> {
  const rows = await conn
    .select({ user: users })
    .from(bookingHosts)
    .innerJoin(users, eq(users.id, bookingHosts.hostId))
    .where(eq(bookingHosts.bookingId, bookingId))
    .orderBy(asc(users.id));
  const all = rows.map((r) => r.user);
  return [...all.filter((u) => u.id === organizerId), ...all.filter((u) => u.id !== organizerId)];
}

/** Load a booking for the self-service manage page, verifying its secret token. */
export async function getBookingForManage(id: string, token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ booking: bookings, eventType: eventTypes, host: users })
    .from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .innerJoin(users, eq(users.id, bookings.hostId))
    .where(eq(bookings.id, id));
  if (!row || !safeEqualHex(row.booking.manageTokenHash, sha256(token))) return null;
  return { ...row, hosts: await hostsOfBooking(db, id, row.booking.hostId) };
}

export type Actor = { kind: "invitee"; token: string } | { kind: "host"; hostId: string };

async function authorize(id: string, actor: Actor) {
  if (actor.kind === "invitee") {
    const row = await getBookingForManage(id, actor.token);
    if (!row) throw new BookingError("FORBIDDEN", "This link is invalid");
    return row;
  }
  // Any host of the meeting may act on it (collective members as well as the organizer).
  const [row] = await db
    .select({ booking: bookings, eventType: eventTypes, host: users })
    .from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .innerJoin(users, eq(users.id, bookings.hostId))
    .innerJoin(bookingHosts, and(eq(bookingHosts.bookingId, bookings.id), eq(bookingHosts.hostId, actor.hostId)))
    .where(eq(bookings.id, id));
  if (!row) throw new BookingError("NOT_FOUND", "Booking not found");
  return { ...row, hosts: await hostsOfBooking(db, id, row.booking.hostId) };
}

export async function rescheduleBooking(id: string, actor: Actor, newStart: string) {
  const row = await authorize(id, actor);
  if (row.booking.status !== "confirmed") throw new BookingError("INVALID", "This booking was cancelled");
  if (row.booking.paymentStatus === "pending") throw new BookingError("INVALID", "This booking is waiting for payment");
  if (row.booking.startAt.getTime() < Date.now()) throw new BookingError("INVALID", "This meeting has already started");
  const start = parseStart(newStart);
  const end = start.plus({ minutes: row.eventType.durationMinutes });
  const [from, to] = [start.minus({ days: 1 }), start.plus({ days: 1 })];
  // The meeting keeps its hosts (round-robin: the assigned one; collective: all of them), and all must be free.
  const hosts = [...row.hosts].sort((a, b) => (a.id < b.id ? -1 : 1));
  const external = await Promise.all(hosts.map((h) => fetchExternalBusy(h.id, from, to)));

  const updated = await translateConflicts(() =>
    db.transaction(async (tx) => {
      for (const h of hosts) await lockHost(tx, h.id);
      const group = isGroup(row.eventType);
      const joining = group && (await groupSeatCheck(tx, row.eventType, start, id)) === "join";
      for (const [i, h] of hosts.entries()) {
        if (joining) continue; // moving into a session that already has invitees
        const availability = onSharedGrid(await buildAvailabilityInput(tx, row.eventType, h, from, to, external[i], id), hosts.length > 1);
        if (!availability || !isSlotAvailable(availability, start.toISO()!)) throw new BookingError("SLOT_UNAVAILABLE", "That time is no longer available");
      }
      const [b] = await tx
        .update(bookings)
        .set({
          startAt: start.toJSDate(),
          endAt: end.toJSDate(),
          icalSequence: sql`${bookings.icalSequence} + 1`,
          ...(group && { sessionKey: sessionKey(row.eventType.id, start) }),
        })
        .where(and(eq(bookings.id, id), eq(bookings.status, "confirmed")))
        .returning();
      if (!b) throw new BookingError("INVALID", "This booking was cancelled");
      return b;
    }),
  );
  await enqueue("booking-rescheduled", { bookingId: id, previousStart: row.booking.startAt.toISOString() });
  return updated;
}

export async function cancelBooking(id: string, actor: Actor, reason?: string) {
  await authorize(id, actor);
  const [b] = await db
    .update(bookings)
    .set({ status: "cancelled", cancelledAt: new Date(), cancelReason: reason?.slice(0, 1000) || null, icalSequence: sql`${bookings.icalSequence} + 1` })
    .where(and(eq(bookings.id, id), eq(bookings.status, "confirmed")))
    .returning();
  if (!b) throw new BookingError("INVALID", "This booking is already cancelled");
  await enqueue("booking-cancelled", { bookingId: id, by: actor.kind });
  return b;
}

function findPgCode(err: unknown): string | undefined {
  for (let e: any = err; e; e = e.cause) if (typeof e.code === "string") return e.code;
  return undefined;
}
