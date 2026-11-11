import { describe, expect, it } from "vitest";
import { canonicalZone, cleanZone, zoneGroups, zoneLabel } from "./timezones";

const JAN = new Date("2026-01-15T12:00:00Z");

describe("time-zone choices", () => {
  it("labels zones by country, adding the city when a country has several", () => {
    expect(zoneLabel("Asia/Kolkata", JAN)).toBe("India (GMT+5:30)");
    expect(zoneLabel("Australia/Sydney", JAN)).toBe("Australia – Sydney (GMT+11)");
    expect(zoneLabel("UTC", JAN)).toBe("UTC (GMT+0)");
  });

  it("accepts current and old zone names from forms, and stores the current one", () => {
    // Node's Intl.supportedValuesOf("timeZone") lists Asia/Calcutta but not Asia/Kolkata; both must pass.
    for (const z of ["Asia/Kolkata", "Europe/Kyiv", "Asia/Ho_Chi_Minh", "Asia/Kathmandu", "Asia/Yangon", "America/New_York"]) expect(cleanZone(z)).toBe(z);
    expect(cleanZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(cleanZone("utc")).toBe("UTC");
    for (const z of ["", "Nope/Zone", "x".repeat(65)]) expect(cleanZone(z)).toBeNull();
  });

  it("maps old browser names to current ones", () => {
    expect(canonicalZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(zoneLabel("Asia/Calcutta", JAN)).toBe("India (GMT+5:30)");
  });

  it("pins the chosen zone, then groups by region with each zone once", () => {
    const groups = zoneGroups("Asia/Calcutta", "Your time zone", JAN);
    expect(groups[0]).toEqual({ label: "Your time zone", options: [{ value: "Asia/Kolkata", label: "India (GMT+5:30)" }] });
    expect(groups.map((g) => g.label)).toEqual([
      "Your time zone", "Americas", "Europe", "Asia", "Africa", "Australia & Pacific", "Indian Ocean", "Atlantic", "Antarctica", "Other",
    ]);
    const rest = groups.slice(1).flatMap((g) => g.options.map((o) => o.value));
    expect(new Set(rest).size).toBe(rest.length);
    expect(rest.some((z) => z.startsWith("Etc/"))).toBe(false);
    const asia = groups.find((g) => g.label === "Asia")!.options.map((o) => o.label);
    expect(asia).toEqual([...asia].sort((a, b) => a.localeCompare(b)));
  });
});
