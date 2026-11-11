import { describe, expect, it } from "vitest";
import { describeMinutes, fill, parseReminders, reminderTime } from "./reminders";

describe("parseReminders", () => {
  it("keeps valid reminders, gives new ones an id and drops empty wording", () => {
    const r = parseReminders(
      JSON.stringify([
        { id: "r24h", when: "before", minutes: 1440, to: "invitee" },
        { when: "after", minutes: 60, to: "host", subject: "Follow up with {{name}}", body: "  " },
      ]),
    )!;
    expect(r[0]).toEqual({ id: "r24h", when: "before", minutes: 1440, to: "invitee" });
    expect(r[1].id).toMatch(/^[0-9a-f]{8}$/);
    expect(r[1]).toMatchObject({ when: "after", minutes: 60, to: "host", subject: "Follow up with {{name}}" });
    expect(r[1].body).toBeUndefined();
  });

  it("rejects bad timings, recipients, JSON and more than 10", () => {
    expect(parseReminders(JSON.stringify([{ when: "before", minutes: 2, to: "invitee" }]))).toBeNull();
    expect(parseReminders(JSON.stringify([{ when: "before", minutes: 31 * 1440, to: "invitee" }]))).toBeNull();
    expect(parseReminders(JSON.stringify([{ when: "during", minutes: 60, to: "invitee" }]))).toBeNull();
    expect(parseReminders(JSON.stringify([{ when: "before", minutes: 60, to: "everyone" }]))).toBeNull();
    expect(parseReminders("nope")).toBeNull();
    expect(parseReminders(JSON.stringify(Array.from({ length: 11 }, () => ({ when: "before", minutes: 60, to: "invitee" }))))).toBeNull();
    expect(parseReminders("[]")).toEqual([]);
  });
});

describe("reminder timing and wording", () => {
  const start = new Date("2026-11-10T10:00:00Z");
  const end = new Date("2026-11-10T10:30:00Z");

  it("counts 'before' from the start and 'after' from the end", () => {
    expect(reminderTime({ id: "a", when: "before", minutes: 60, to: "invitee" }, start, end).toISOString()).toBe("2026-11-10T09:00:00.000Z");
    expect(reminderTime({ id: "b", when: "after", minutes: 60, to: "invitee" }, start, end).toISOString()).toBe("2026-11-10T11:30:00.000Z");
  });

  it("describes durations in the largest whole unit", () => {
    expect(describeMinutes(60)).toBe("1 hour");
    expect(describeMinutes(1440 * 2)).toBe("2 days");
    expect(describeMinutes(90)).toBe("90 minutes");
  });

  it("fills placeholders and leaves unknown ones alone", () => {
    const v = { name: "Ann", event: "Intro", time: "Tue 10:00", host: "Sam", location: "", manage_link: "m", booking_link: "b" };
    expect(fill("Hi {{name}}, see you at {{ event }} ({{time}}). {{unknown}}", v)).toBe("Hi Ann, see you at Intro (Tue 10:00). {{unknown}}");
  });
});
