import { describe, expect, it } from "vitest";
import { googleCalendarUrl, icsFile, outlookCalendarUrl } from "./calendar-links";

const e = { title: "Intro call with Ann", start: "2026-11-09T14:00:00.000Z", end: "2026-11-09T14:30:00.000Z", details: "Join: link, see email", location: "Google Meet" };

describe("add to calendar", () => {
  it("builds a Google Calendar link in UTC", () => {
    const u = new URL(googleCalendarUrl(e));
    expect(u.searchParams.get("dates")).toBe("20261109T140000Z/20261109T143000Z");
    expect(u.searchParams.get("text")).toBe("Intro call with Ann");
    expect(u.searchParams.get("location")).toBe("Google Meet");
  });

  it("builds an Outlook link", () => {
    const u = new URL(outlookCalendarUrl(e));
    expect(u.searchParams.get("startdt")).toBe("2026-11-09T14:00:00.000Z");
    expect(u.searchParams.get("subject")).toBe("Intro call with Ann");
  });

  it("builds an .ics file with escaped text and CRLF lines", () => {
    const ics = icsFile(e, "abc@slotnest", new Date("2026-11-01T00:00:00Z"));
    expect(ics).toContain("DTSTART:20261109T140000Z\r\nDTEND:20261109T143000Z\r\n");
    expect(ics).toContain("DESCRIPTION:Join: link\\, see email\r\n");
    expect(ics).toContain("METHOD:PUBLISH");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it.each([
    ["title", "SUMMARY"],
    ["details", "DESCRIPTION"],
    ["location", "LOCATION"],
  ])("escapes semicolons in the .ics %s field", (field, property) => {
    const ics = icsFile({ ...e, [field]: "Planning; review" }, "abc@slotnest");
    expect(ics.split("\r\n")).toContain(`${property}:Planning\\; review`);
  });

  it("builds an .ics file without optional details or location", () => {
    const ics = icsFile({ title: e.title, start: e.start, end: e.end }, "abc@slotnest");
    expect(ics).toContain(`SUMMARY:${e.title}\r\n`);
    expect(ics).not.toContain("DESCRIPTION:");
    expect(ics).not.toContain("LOCATION:");
  });
});
