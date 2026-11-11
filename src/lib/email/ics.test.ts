import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine, type IcsEvent } from "./ics";

const base: IcsEvent = {
  method: "REQUEST",
  uid: "abc123@slotnest",
  sequence: 0,
  start: new Date("2026-11-03T15:00:00Z"),
  end: new Date("2026-11-03T15:30:00Z"),
  summary: "Fit call: Jane Doe and AT20 Team",
  description: "Line one\nLine two; with, punctuation",
  location: "https://meet.google.com/abc-defg-hij",
  organizer: { name: "AT20 Team", email: "host@example.test" },
  attendees: [{ name: "Jane Doe", email: "jane@example.test" }],
  stamp: new Date("2026-11-01T00:00:00Z"),
};

describe("buildIcs", () => {
  it("produces a CRLF-terminated REQUEST with UTC times, stable UID and sequence", () => {
    const ics = buildIcs(base);
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.split("\r\n").every((l) => !l.includes("\n"))).toBe(true);
    expect(ics).toContain("METHOD:REQUEST");
    expect(ics).toContain("UID:abc123@slotnest");
    expect(ics).toContain("SEQUENCE:0");
    expect(ics).toContain("DTSTART:20261103T150000Z");
    expect(ics).toContain("DTEND:20261103T153000Z");
    expect(ics).toContain("DTSTAMP:20261101T000000Z");
    expect(ics).toContain("STATUS:CONFIRMED");
    expect(ics).toContain('ORGANIZER;CN="AT20 Team":mailto:host@example.test');
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two\\; with\\, punctuation");
    expect(ics).toContain("BEGIN:VALARM");
  });

  it("produces a CANCEL with a higher sequence and no alarm", () => {
    const ics = buildIcs({ ...base, method: "CANCEL", sequence: 2 });
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
    expect(ics).toContain("SEQUENCE:2");
    expect(ics).not.toContain("VALARM");
  });

  it("strips quotes and newlines from display names", () => {
    const ics = buildIcs({ ...base, attendees: [{ name: 'Evil "Name"\r\nX-INJECT:1', email: "e@example.test" }] });
    expect(ics).not.toContain("\r\nX-INJECT");
    expect(ics).toContain('CN="Evil NameX-INJECT:1"');
  });
});

describe("folding and escaping", () => {
  it("folds long lines at 75 octets without splitting multi-byte characters", () => {
    const line = "DESCRIPTION:" + "é".repeat(100);
    const folded = foldLine(line).split("\r\n");
    expect(folded.length).toBeGreaterThan(1);
    for (const l of folded) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.slice(1).every((l) => l.startsWith(" "))).toBe(true);
    expect(folded.map((l, i) => (i === 0 ? l : l.slice(1))).join("")).toBe(line);
  });

  it("leaves short lines alone", () => {
    expect(foldLine("SUMMARY:Hi")).toBe("SUMMARY:Hi");
  });

  it("escapes backslashes, semicolons, commas and newlines", () => {
    expect(escapeText("a\\b;c,d\r\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });
});
