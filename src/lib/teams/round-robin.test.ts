import { describe, expect, it } from "vitest";
import { pickHost } from "./round-robin";

const d = (iso: string) => new Date(iso);

describe("pickHost (equal distribution)", () => {
  it("picks the host with the fewest recent bookings", () => {
    expect(
      pickHost([
        { hostId: "a", recentCount: 3, lastAssignedAt: d("2026-10-01T00:00:00Z") },
        { hostId: "b", recentCount: 1, lastAssignedAt: d("2026-10-30T00:00:00Z") },
        { hostId: "c", recentCount: 2, lastAssignedAt: null },
      ]),
    ).toBe("b");
  });

  it("breaks ties by longest since last assignment, never-assigned first", () => {
    const loads = [
      { hostId: "a", recentCount: 1, lastAssignedAt: d("2026-10-20T00:00:00Z") },
      { hostId: "b", recentCount: 1, lastAssignedAt: d("2026-10-10T00:00:00Z") },
    ];
    expect(pickHost(loads)).toBe("b");
    expect(pickHost([...loads, { hostId: "c", recentCount: 1, lastAssignedAt: null }])).toBe("c");
  });

  it("is deterministic when everything ties", () => {
    const loads = ["m", "k", "z"].map((hostId) => ({ hostId, recentCount: 0, lastAssignedAt: null }));
    expect(pickHost(loads)).toBe("k");
    expect(pickHost(loads.reverse())).toBe("k");
  });

  it("rejects an empty candidate list", () => {
    expect(() => pickHost([])).toThrow();
  });
});
