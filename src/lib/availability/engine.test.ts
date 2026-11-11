import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  computeSlots,
  intersectSlots,
  SHARED_GRID_MINUTES,
  thinSlots,
  mergeSlots,
  groupSlotsByLocalDate,
  isSlotAvailable,
  windowRealMinutes,
  type AvailabilityInput,
  type Weekday,
  type WeeklyRule,
} from "./engine";

const H = (h: number, m = 0) => h * 60 + m;
const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5];
const rules = (days: Weekday[], start: number, end: number): WeeklyRule[] =>
  days.map((weekday) => ({ weekday, startMinute: start, endMinute: end }));

/** Build input for a single host-local date; `now` is far in the past so notice/window don't interfere. */
function day(zone: string, isoDate: string, overrides: Partial<AvailabilityInput> = {}): AvailabilityInput {
  const start = DateTime.fromISO(isoDate, { zone }).startOf("day");
  return {
    hostTimeZone: zone,
    weeklyRules: rules(ALL_DAYS, H(9), H(17)),
    durationMinutes: 30,
    rangeStart: start.toUTC().toISO()!,
    rangeEnd: start.plus({ days: 1 }).startOf("day").toUTC().toISO()!,
    now: "2020-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const starts = (input: AvailabilityInput) => computeSlots(input).map((s) => s.start);
const localStarts = (input: AvailabilityInput, zone: string) =>
  computeSlots(input).map((s) => DateTime.fromISO(s.start).setZone(zone).toFormat("HH:mm ZZ"));

describe("basic slot generation", () => {
  it("generates 16 half-hour slots for a 9–17 New York day in winter (EST, UTC−5)", () => {
    const slots = computeSlots(day("America/New_York", "2026-01-14"));
    expect(slots).toHaveLength(16);
    expect(slots[0]).toEqual({ start: "2026-01-14T14:00:00.000Z", end: "2026-01-14T14:30:00.000Z" });
    expect(slots.at(-1)!.end).toBe("2026-01-14T22:00:00.000Z");
  });

  it("uses the slot interval independently of duration and never overruns the window", () => {
    const slots = computeSlots(day("UTC", "2026-01-14", { durationMinutes: 45, slotIntervalMinutes: 15 }));
    expect(slots[0].start).toBe("2026-01-14T09:00:00.000Z");
    expect(slots.at(-1)!.start).toBe("2026-01-14T16:15:00.000Z");
    expect(slots.at(-1)!.end).toBe("2026-01-14T17:00:00.000Z");
  });

  it("supports a window ending at 24:00", () => {
    const slots = computeSlots(day("UTC", "2026-01-14", { weeklyRules: rules(ALL_DAYS, H(22), 1440), durationMinutes: 60 }));
    expect(slots.map((s) => s.start)).toEqual(["2026-01-14T22:00:00.000Z", "2026-01-14T23:00:00.000Z"]);
  });

  it("returns nothing on days without rules", () => {
    expect(computeSlots(day("UTC", "2026-01-17", { weeklyRules: rules(WEEKDAYS, H(9), H(17)) }))).toEqual([]); // Saturday
  });

  it("merges multiple windows per day and de-duplicates overlapping ones", () => {
    const weeklyRules: WeeklyRule[] = [
      { weekday: 3, startMinute: H(9), endMinute: H(10) },
      { weekday: 3, startMinute: H(9, 30), endMinute: H(11) },
    ];
    expect(starts(day("UTC", "2026-01-14", { weeklyRules, durationMinutes: 30 }))).toEqual([
      "2026-01-14T09:00:00.000Z",
      "2026-01-14T09:30:00.000Z",
      "2026-01-14T10:00:00.000Z",
      "2026-01-14T10:30:00.000Z",
    ]);
  });

  it("rejects unknown time zones and invalid windows", () => {
    expect(() => computeSlots(day("Mars/Olympus_Mons", "2026-01-14"))).toThrow(/time zone/);
    expect(() => computeSlots(day("UTC", "2026-01-14", { weeklyRules: rules(ALL_DAYS, H(17), H(9)) }))).toThrow(/Invalid window/);
  });
});

describe("US daylight saving (America/New_York)", () => {
  it("spring forward (2026-03-08): 00:00–05:00 has only 4 real hours and skips 02:00", () => {
    const input = day("America/New_York", "2026-03-08", { weeklyRules: rules(ALL_DAYS, 0, H(5)), durationMinutes: 60 });
    expect(localStarts(input, "America/New_York")).toEqual(["00:00 -05:00", "01:00 -05:00", "03:00 -04:00", "04:00 -04:00"]);
    expect(windowRealMinutes("America/New_York", "2026-03-08", 0, H(5))).toBe(240);
  });

  it("spring forward: a window entirely inside the gap (02:00–03:00) produces no slots", () => {
    const input = day("America/New_York", "2026-03-08", { weeklyRules: rules(ALL_DAYS, H(2), H(3)), durationMinutes: 30 });
    expect(computeSlots(input)).toEqual([]);
  });

  it("spring forward: a window starting inside the gap starts at the first real instant", () => {
    const input = day("America/New_York", "2026-03-08", { weeklyRules: rules(ALL_DAYS, H(2, 30), H(4)), durationMinutes: 30 });
    expect(localStarts(input, "America/New_York")).toEqual(["03:30 -04:00"]);
  });

  it("fall back (2026-11-01): 00:00–04:00 has 5 real hours and offers 01:00 twice (EDT then EST)", () => {
    const input = day("America/New_York", "2026-11-01", { weeklyRules: rules(ALL_DAYS, 0, H(4)), durationMinutes: 60 });
    expect(localStarts(input, "America/New_York")).toEqual([
      "00:00 -04:00",
      "01:00 -04:00",
      "01:00 -05:00",
      "02:00 -05:00",
      "03:00 -05:00",
    ]);
    expect(new Set(starts(input)).size).toBe(5);
  });

  it("keeps 09:00 wall-clock across the change: UTC start moves from 14:00Z to 13:00Z", () => {
    const zone = "America/New_York";
    const input: AvailabilityInput = {
      hostTimeZone: zone,
      weeklyRules: rules(WEEKDAYS, H(9), H(17)),
      durationMinutes: 30,
      rangeStart: "2026-03-06T00:00:00Z",
      rangeEnd: "2026-03-10T00:00:00Z",
      now: "2020-01-01T00:00:00Z",
    };
    const days = groupSlotsByLocalDate(computeSlots(input), zone);
    expect(days.map((d) => d.date)).toEqual(["2026-03-06", "2026-03-09"]);
    expect(days[0].slots[0].start).toBe("2026-03-06T14:00:00.000Z");
    expect(days[1].slots[0].start).toBe("2026-03-09T13:00:00.000Z");
    expect(days.every((d) => d.slots.length === 16 && d.slots[0].localTime === "09:00")).toBe(true);
  });

  it("invariant: every day of 2026 has exactly 16 slots between 09:00 and 17:00 local, in several zones", () => {
    for (const zone of ["America/New_York", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Australia/Sydney", "Asia/Kolkata", "Australia/Lord_Howe"]) {
      const input: AvailabilityInput = {
        hostTimeZone: zone,
        weeklyRules: rules(ALL_DAYS, H(9), H(17)),
        durationMinutes: 30,
        rangeStart: DateTime.fromISO("2026-01-01", { zone }).toUTC().toISO()!,
        rangeEnd: DateTime.fromISO("2027-01-01", { zone }).toUTC().toISO()!,
        now: "2020-01-01T00:00:00Z",
      };
      const days = groupSlotsByLocalDate(computeSlots(input), zone);
      expect(days).toHaveLength(365);
      for (const d of days) {
        expect(d.slots, `${zone} ${d.date}`).toHaveLength(16);
        expect(d.slots[0].localTime).toBe("09:00");
        expect(d.slots.at(-1)!.localTime).toBe("16:30");
      }
    }
  });
});

describe("cross-zone viewing", () => {
  it("US/EU DST gap weeks: London 09:00 is 05:00 in New York in mid-March but 04:00 in April", () => {
    const base = {
      hostTimeZone: "Europe/London",
      weeklyRules: rules(WEEKDAYS, H(9), H(17)),
      durationMinutes: 30,
      now: "2020-01-01T00:00:00Z",
    };
    const gapWeek = computeSlots({ ...base, rangeStart: "2026-03-16T00:00:00Z", rangeEnd: "2026-03-17T00:00:00Z" });
    const april = computeSlots({ ...base, rangeStart: "2026-04-06T00:00:00Z", rangeEnd: "2026-04-07T00:00:00Z" });
    const winter = computeSlots({ ...base, rangeStart: "2026-02-02T00:00:00Z", rangeEnd: "2026-02-03T00:00:00Z" });

    expect(gapWeek[0].start).toBe("2026-03-16T09:00:00.000Z"); // GMT
    expect(april[0].start).toBe("2026-04-06T08:00:00.000Z"); // BST
    expect(groupSlotsByLocalDate(winter, "America/New_York")[0].slots[0].localTime).toBe("04:00"); // 5h apart
    expect(groupSlotsByLocalDate(gapWeek, "America/New_York")[0].slots[0].localTime).toBe("05:00"); // only 4h apart
    expect(groupSlotsByLocalDate(april, "America/New_York")[0].slots[0].localTime).toBe("04:00"); // 5h apart again
  });

  it("date line: a Monday-morning Kiritimati (UTC+14) slot is Sunday for a Pago Pago (UTC−11) invitee", () => {
    const slots = computeSlots(day("Pacific/Kiritimati", "2026-06-15", { weeklyRules: rules([1], H(9), H(10)), durationMinutes: 60 }));
    expect(slots).toEqual([{ start: "2026-06-14T19:00:00.000Z", end: "2026-06-14T20:00:00.000Z" }]);
    const pagoPago = groupSlotsByLocalDate(slots, "Pacific/Pago_Pago");
    expect(pagoPago).toEqual([{ date: "2026-06-14", slots: [{ ...slots[0], localTime: "08:00" }] }]);
  });

  it("half-hour and 45-minute offsets (Kolkata +05:30, Kathmandu +05:45) map correctly with no DST", () => {
    expect(starts(day("Asia/Kolkata", "2026-07-01"))[0]).toBe("2026-07-01T03:30:00.000Z");
    expect(starts(day("Asia/Kathmandu", "2026-07-01"))[0]).toBe("2026-07-01T03:15:00.000Z");
  });

  it("zones without DST keep the same UTC time across the US change (America/Phoenix)", () => {
    expect(starts(day("America/Phoenix", "2026-03-06"))[0]).toBe("2026-03-06T16:00:00.000Z");
    expect(starts(day("America/Phoenix", "2026-03-09"))[0]).toBe("2026-03-09T16:00:00.000Z");
  });

  it("a host window that spans midnight UTC is returned for the range that contains it", () => {
    // Sydney 09:00–17:00 on 2026-07-01 (AEST, UTC+10) is 2026-06-30T23:00Z – 2026-07-01T07:00Z.
    const slots = computeSlots({
      hostTimeZone: "Australia/Sydney",
      weeklyRules: rules(ALL_DAYS, H(9), H(17)),
      durationMinutes: 60,
      rangeStart: "2026-06-30T23:00:00Z",
      rangeEnd: "2026-07-01T01:00:00Z",
      now: "2020-01-01T00:00:00Z",
    });
    expect(slots.map((s) => s.start)).toEqual(["2026-06-30T23:00:00.000Z", "2026-07-01T00:00:00.000Z"]);
  });
});

describe("unusual DST rules", () => {
  it("Lord Howe Island shifts by 30 minutes: 00:00–03:00 on 2026-04-05 lasts 3.5 real hours", () => {
    const input = day("Australia/Lord_Howe", "2026-04-05", { weeklyRules: rules(ALL_DAYS, 0, H(3)), durationMinutes: 30 });
    expect(windowRealMinutes("Australia/Lord_Howe", "2026-04-05", 0, H(3))).toBe(210);
    expect(localStarts(input, "Australia/Lord_Howe")).toEqual([
      "00:00 +11:00",
      "00:30 +11:00",
      "01:00 +11:00",
      "01:30 +11:00",
      "01:30 +10:30",
      "02:00 +10:30",
      "02:30 +10:30",
    ]);
  });

  it("Lord Howe spring forward (2026-10-04): 02:00–02:30 does not exist", () => {
    const input = day("Australia/Lord_Howe", "2026-10-04", { weeklyRules: rules(ALL_DAYS, H(1), H(3)), durationMinutes: 30 });
    expect(localStarts(input, "Australia/Lord_Howe")).toEqual(["01:00 +10:30", "01:30 +10:30", "02:30 +11:00"]);
  });

  it("Santiago skips midnight (2026-09-06): a 00:00–02:00 window starts at 01:00", () => {
    const input = day("America/Santiago", "2026-09-06", { weeklyRules: rules(ALL_DAYS, 0, H(2)), durationMinutes: 60 });
    expect(localStarts(input, "America/Santiago")).toEqual(["01:00 -03:00"]);
  });
});

describe("constraints", () => {
  it("removes slots that overlap busy blocks, including buffers", () => {
    const input = day("UTC", "2026-01-14", {
      weeklyRules: rules(ALL_DAYS, H(9), H(12)),
      busy: [{ start: "2026-01-14T10:00:00Z", end: "2026-01-14T10:30:00Z" }],
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15,
    });
    // 09:30 ends at 10:00 + 15 min after-buffer → overlaps; 10:30 starts with 15 min before-buffer → overlaps.
    expect(starts(input)).toEqual([
      "2026-01-14T09:00:00.000Z",
      "2026-01-14T11:00:00.000Z",
      "2026-01-14T11:30:00.000Z",
    ]);
  });

  it("an existing booking's after-buffer blocks the slot that starts when it ends", () => {
    const input = day("UTC", "2026-01-14", {
      weeklyRules: rules(ALL_DAYS, H(9), H(11)),
      busy: [{ start: "2026-01-14T09:30:00Z", end: "2026-01-14T10:00:00Z", source: "booking" }],
      bufferAfterMinutes: 10,
    });
    // 09:00 + its 10 min after-buffer overlaps the 09:30 booking; 10:00 falls inside that booking's after-buffer.
    expect(starts(input)).toEqual(["2026-01-14T10:30:00.000Z"]);
  });

  it("external calendar events are not padded by our buffers", () => {
    const input = day("UTC", "2026-01-14", {
      weeklyRules: rules(ALL_DAYS, H(9), H(11)),
      busy: [{ start: "2026-01-14T09:30:00Z", end: "2026-01-14T10:00:00Z", source: "calendar" }],
      bufferAfterMinutes: 10,
    });
    expect(starts(input)).toEqual(["2026-01-14T10:00:00.000Z", "2026-01-14T10:30:00.000Z"]);
  });

  it("allows back-to-back slots when there are no buffers", () => {
    const input = day("UTC", "2026-01-14", {
      weeklyRules: rules(ALL_DAYS, H(9), H(11)),
      busy: [{ start: "2026-01-14T10:00:00Z", end: "2026-01-14T10:30:00Z" }],
    });
    expect(starts(input)).toEqual(["2026-01-14T09:00:00.000Z", "2026-01-14T09:30:00.000Z", "2026-01-14T10:30:00.000Z"]);
  });

  it("applies minimum notice and the booking window relative to now", () => {
    const input = day("UTC", "2026-01-14", { now: "2026-01-14T10:05:00Z", minimumNoticeMinutes: 60, bookingWindowDays: 0.25 });
    // earliest 11:05 → first slot 11:30; window ends 16:05 → last slot starts 16:00.
    const s = starts(input);
    expect(s[0]).toBe("2026-01-14T11:30:00.000Z");
    expect(s.at(-1)).toBe("2026-01-14T16:00:00.000Z");
  });

  it("date overrides replace weekly rules; an empty override blocks the day", () => {
    const special = day("UTC", "2026-12-24", {
      dateOverrides: [{ date: "2026-12-24", windows: [{ startMinute: H(10), endMinute: H(11) }] }],
    });
    expect(starts(special)).toEqual(["2026-12-24T10:00:00.000Z", "2026-12-24T10:30:00.000Z"]);
    expect(computeSlots(day("UTC", "2026-12-25", { dateOverrides: [{ date: "2026-12-25", windows: [] }] }))).toEqual([]);
  });

  it("overrides are keyed by the host's local date, not the UTC date", () => {
    // Tokyo 2026-05-01 09:00 is 2026-05-01T00:00Z; 2026-04-30 in UTC terms is a different local day.
    const input = day("Asia/Tokyo", "2026-05-01", { dateOverrides: [{ date: "2026-05-01", windows: [] }] });
    expect(computeSlots(input)).toEqual([]);
  });

  it("maxPerDay counts only our own bookings on the host-local day", () => {
    const zone = "America/New_York";
    const busy = [
      { start: "2026-01-14T14:00:00Z", end: "2026-01-14T14:30:00Z", source: "booking" as const },
      { start: "2026-01-14T15:00:00Z", end: "2026-01-14T15:30:00Z", source: "calendar" as const },
    ];
    expect(computeSlots(day(zone, "2026-01-14", { busy, maxPerDay: 1 }))).toEqual([]);
    expect(computeSlots(day(zone, "2026-01-14", { busy, maxPerDay: 2 }))).toHaveLength(14);
  });

  it("isSlotAvailable re-validates an exact start instant", () => {
    const input = day("America/New_York", "2026-01-14");
    expect(isSlotAvailable(input, "2026-01-14T14:00:00Z")).toBe(true);
    expect(isSlotAvailable(input, "2026-01-14T14:10:00Z")).toBe(false);
    expect(isSlotAvailable({ ...input, busy: [{ start: "2026-01-14T14:00:00Z", end: "2026-01-14T14:30:00Z" }] }, "2026-01-14T14:00:00Z")).toBe(false);
  });
});

describe("mergeSlots (round-robin union)", () => {
  it("unions hosts' slots, sorted, one per start", () => {
    const s = (h: number) => ({ start: `2026-11-02T${String(h).padStart(2, "0")}:00:00.000Z`, end: `2026-11-02T${String(h).padStart(2, "0")}:30:00.000Z` });
    expect(mergeSlots([[s(9), s(11)], [s(10), s(11)], []])).toEqual([s(9), s(10), s(11)]);
    expect(mergeSlots([])).toEqual([]);
  });
});

describe("intersectSlots (collective)", () => {
  const s = (h: number) => ({ start: `2026-11-02T${String(h).padStart(2, "0")}:00:00.000Z`, end: `2026-11-02T${String(h).padStart(2, "0")}:30:00.000Z` });
  it("keeps only times every host has", () => {
    expect(intersectSlots([[s(11), s(9), s(10)], [s(10), s(11), s(12)], [s(11), s(10)]])).toEqual([s(10), s(11)]);
  });
  it("is empty when there are no hosts or one host has nothing", () => {
    expect(intersectSlots([])).toEqual([]);
    expect(intersectSlots([[s(9)], []])).toEqual([]);
  });
});

describe("collective slots across misaligned windows", () => {
  // Host A (London) works 09:00–17:00 UTC, host B (New York, winter) 14:00–22:00 UTC; 45-minute meetings.
  // On their own grids they'd never share a start (A: 14:15, 15:00 …; B: 14:00, 14:45 …).
  const base = {
    durationMinutes: 45,
    rangeStart: "2026-12-07T00:00:00Z",
    rangeEnd: "2026-12-08T00:00:00Z",
    now: "2026-12-01T00:00:00Z",
  };
  const a = { ...base, hostTimeZone: "Europe/London", weeklyRules: [{ weekday: 1 as const, startMinute: 540, endMinute: 1020 }] };
  const b = { ...base, hostTimeZone: "America/New_York", weeklyRules: [{ weekday: 1 as const, startMinute: 540, endMinute: 1020 }] };

  it("finds shared times on the fine grid, spaced by the meeting length", () => {
    expect(intersectSlots([computeSlots(a), computeSlots(b)])).toEqual([]);
    const fine = (x: typeof a) => computeSlots({ ...x, slotIntervalMinutes: SHARED_GRID_MINUTES });
    const starts = thinSlots(intersectSlots([fine(a), fine(b)]), 45).map((s) => s.start.slice(11, 16));
    expect(starts).toEqual(["14:00", "14:45", "15:30", "16:15"]); // the last ends at 17:00, London's end
  });
});
