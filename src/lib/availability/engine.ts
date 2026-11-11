import { DateTime, Interval as LuxonInterval } from "luxon";

/**
 * Availability engine: a pure function from (rules, busy times, now) to bookable slots.
 *
 * Time model:
 * - Availability rules are wall-clock times in the HOST's IANA time zone ("Mon 09:00–17:00").
 * - Everything else (busy blocks, slots, range, now) is absolute instants, represented as UTC ISO strings.
 * - The invitee's time zone is purely presentational; see `groupSlotsByLocalDate`.
 *
 * DST rules:
 * - A wall-clock time that does not exist (spring-forward gap) is shifted forward by Luxon,
 *   e.g. 02:30 America/New_York on spring-forward day becomes 03:30 EDT.
 * - Slots are stepped in absolute minutes from the window start, so a window that spans a
 *   fall-back hour contains the repeated hour twice (two distinct instants), and a window that
 *   spans a spring-forward hour is one hour shorter in real time.
 */

export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7; // ISO: 1 = Monday … 7 = Sunday

export interface WeeklyRule {
  weekday: Weekday;
  /** Minutes since local midnight, 0–1440. */
  startMinute: number;
  /** Minutes since local midnight, 1–1440 (1440 = end of day). Must be > startMinute. */
  endMinute: number;
}

export interface DateOverride {
  /** Host-local calendar date, YYYY-MM-DD. */
  date: string;
  /** Replaces the weekly rules for that date. Empty array = unavailable all day. */
  windows: { startMinute: number; endMinute: number }[];
}

export interface BusyBlock {
  start: string;
  end: string;
  /** Bookings made through this product count toward `maxPerDay`; external calendar events do not. */
  source?: "booking" | "calendar";
}

export interface AvailabilityInput {
  hostTimeZone: string;
  weeklyRules: WeeklyRule[];
  dateOverrides?: DateOverride[];
  durationMinutes: number;
  /** Distance between slot starts. Defaults to the duration. */
  slotIntervalMinutes?: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
  minimumNoticeMinutes?: number;
  /** Slots must start within this many days of `now`. */
  bookingWindowDays?: number;
  /** Max bookings per host-local day. */
  maxPerDay?: number;
  busy?: BusyBlock[];
  /** Only slots starting in [rangeStart, rangeEnd) are returned. */
  rangeStart: string;
  rangeEnd: string;
  now: string;
}

export interface Slot {
  start: string;
  end: string;
  /** Group events: how many invitees can still book this time. */
  seatsLeft?: number;
}

const MINUTES_PER_DAY = 1440;

function toUtc(iso: string): DateTime {
  const dt = DateTime.fromISO(iso, { zone: "utc" });
  if (!dt.isValid) throw new Error(`Invalid ISO instant: ${iso}`);
  return dt;
}

/** Host-local wall-clock minute on a given local date, resolved to an instant. 1440 means next midnight. */
function wallClock(date: DateTime, minute: number): DateTime {
  if (minute === MINUTES_PER_DAY) return date.plus({ days: 1 }).startOf("day");
  return DateTime.fromObject(
    { year: date.year, month: date.month, day: date.day, hour: Math.floor(minute / 60), minute: minute % 60 },
    { zone: date.zone },
  );
}

function validateWindow(startMinute: number, endMinute: number) {
  if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)) throw new Error("Window minutes must be integers");
  if (startMinute < 0 || endMinute > MINUTES_PER_DAY || startMinute >= endMinute) {
    throw new Error(`Invalid window ${startMinute}–${endMinute}`);
  }
}

export function computeSlots(input: AvailabilityInput): Slot[] {
  const zone = input.hostTimeZone;
  if (!DateTime.now().setZone(zone).isValid) throw new Error(`Unknown time zone: ${zone}`);
  if (input.durationMinutes <= 0) throw new Error("durationMinutes must be positive");

  const duration = input.durationMinutes;
  const step = input.slotIntervalMinutes ?? duration;
  if (step <= 0) throw new Error("slotIntervalMinutes must be positive");
  const bufferBefore = input.bufferBeforeMinutes ?? 0;
  const bufferAfter = input.bufferAfterMinutes ?? 0;

  const now = toUtc(input.now);
  let earliest = toUtc(input.rangeStart);
  const noticeCutoff = now.plus({ minutes: input.minimumNoticeMinutes ?? 0 });
  if (noticeCutoff > earliest) earliest = noticeCutoff;
  let latest = toUtc(input.rangeEnd);
  if (input.bookingWindowDays !== undefined) {
    const windowEnd = now.plus({ days: input.bookingWindowDays });
    if (windowEnd < latest) latest = windowEnd;
  }
  if (earliest >= latest) return [];

  // Our own bookings carry this event type's buffers too, so the gap between two bookings is
  // (earlier booking's after-buffer + later booking's before-buffer). External events are used as-is.
  const busy = (input.busy ?? []).map((b) => {
    const source = b.source ?? "calendar";
    const pad = source === "booking";
    return {
      start: toUtc(b.start).toMillis() - (pad ? bufferBefore * 60_000 : 0),
      end: toUtc(b.end).toMillis() + (pad ? bufferAfter * 60_000 : 0),
      bookingStart: toUtc(b.start).toMillis(),
      source,
    };
  });

  const overrides = new Map<string, DateOverride["windows"]>();
  for (const o of input.dateOverrides ?? []) overrides.set(o.date, o.windows);

  // Count our own bookings per host-local day for maxPerDay.
  const bookingsPerDay = new Map<string, number>();
  if (input.maxPerDay !== undefined) {
    for (const b of busy) {
      if (b.source !== "booking") continue;
      const day = DateTime.fromMillis(b.bookingStart, { zone }).toISODate()!;
      bookingsPerDay.set(day, (bookingsPerDay.get(day) ?? 0) + 1);
    }
  }

  // Walk host-local dates; pad by a day on each side so windows that straddle the range edges are included.
  const firstDay = earliest.setZone(zone).startOf("day").minus({ days: 1 });
  const lastDay = latest.setZone(zone).startOf("day").plus({ days: 1 });

  const seen = new Set<number>();
  const slots: { start: number; end: number }[] = [];

  for (let day = firstDay; day <= lastDay; day = day.plus({ days: 1 }).startOf("day")) {
    const isoDate = day.toISODate()!;
    if (input.maxPerDay !== undefined && (bookingsPerDay.get(isoDate) ?? 0) >= input.maxPerDay) continue;

    const windows = overrides.has(isoDate)
      ? overrides.get(isoDate)!
      : input.weeklyRules.filter((r) => r.weekday === day.weekday);

    for (const w of windows) {
      validateWindow(w.startMinute, w.endMinute);
      const windowStart = wallClock(day, w.startMinute).toUTC();
      const windowEnd = wallClock(day, w.endMinute).toUTC();
      if (windowEnd <= windowStart) continue; // e.g. a window entirely inside a spring-forward gap

      for (let s = windowStart; s.plus({ minutes: duration }) <= windowEnd; s = s.plus({ minutes: step })) {
        if (s < earliest || s >= latest) continue;
        const startMs = s.toMillis();
        if (seen.has(startMs)) continue;
        const endMs = s.plus({ minutes: duration }).toMillis();
        const paddedStart = startMs - bufferBefore * 60_000;
        const paddedEnd = endMs + bufferAfter * 60_000;
        if (busy.some((b) => b.start < paddedEnd && b.end > paddedStart)) continue;
        seen.add(startMs);
        slots.push({ start: startMs, end: endMs });
      }
    }
  }

  slots.sort((a, b) => a.start - b.start);
  return slots.map((s) => ({
    start: DateTime.fromMillis(s.start, { zone: "utc" }).toISO()!,
    end: DateTime.fromMillis(s.end, { zone: "utc" }).toISO()!,
  }));
}

/** True if `start` is exactly one of the slots the engine would offer. Used to re-validate at booking time. */
export function isSlotAvailable(input: AvailabilityInput, start: string): boolean {
  const target = toUtc(start).toMillis();
  return computeSlots(input).some((s) => toUtc(s.start).toMillis() === target);
}

/** Union of several hosts' slots (round-robin: a time is bookable if any host is free). Sorted, one per start. */
export function mergeSlots(lists: Slot[][]): Slot[] {
  const byStart = new Map<number, Slot>();
  for (const list of lists) for (const s of list) byStart.set(toUtc(s.start).toMillis(), s);
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}

/**
 * Times every host can do (collective events). Sorted; empty if there are no hosts.
 * Each host's slots step from their own window start, so compute them on a fine shared grid (SHARED_GRID_MINUTES)
 * before intersecting, then space the result out with `thinSlots`.
 */
export function intersectSlots(lists: Slot[][]): Slot[] {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  const others = rest.map((l) => new Set(l.map((s) => toUtc(s.start).toMillis())));
  return mergeSlots([first]).filter((s) => others.every((o) => o.has(toUtc(s.start).toMillis())));
}

/** Step for multi-host slot computation. UTC offsets are multiples of 15 minutes, so 5 aligns all hosts. */
export const SHARED_GRID_MINUTES = 5;

/** Space out fine-grid slots: keep the earliest, then the next one at least `stepMinutes` later, and so on. */
export function thinSlots(slots: Slot[], stepMinutes: number): Slot[] {
  const kept: Slot[] = [];
  let next = -Infinity;
  for (const s of slots) {
    const t = toUtc(s.start).toMillis();
    if (t < next) continue;
    kept.push(s);
    next = t + stepMinutes * 60_000;
  }
  return kept;
}

export interface LocalDay {
  /** Viewer-local date, YYYY-MM-DD. */
  date: string;
  slots: (Slot & { localTime: string })[];
}

/** Group UTC slots by calendar date in the viewer's time zone (the invitee's view of the booking page). */
export function groupSlotsByLocalDate(slots: Slot[], viewerTimeZone: string): LocalDay[] {
  const days = new Map<string, LocalDay>();
  for (const slot of slots) {
    const local = toUtc(slot.start).setZone(viewerTimeZone);
    if (!local.isValid) throw new Error(`Unknown time zone: ${viewerTimeZone}`);
    const date = local.toISODate()!;
    if (!days.has(date)) days.set(date, { date, slots: [] });
    days.get(date)!.slots.push({ ...slot, localTime: local.toFormat("HH:mm") });
  }
  return [...days.values()];
}

/** Real elapsed minutes of a host-local window on a date (shorter/longer than nominal on DST days). */
export function windowRealMinutes(hostTimeZone: string, isoDate: string, startMinute: number, endMinute: number): number {
  const day = DateTime.fromISO(isoDate, { zone: hostTimeZone }).startOf("day");
  return LuxonInterval.fromDateTimes(wallClock(day, startMinute), wallClock(day, endMinute)).length("minutes");
}
