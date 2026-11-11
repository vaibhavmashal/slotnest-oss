/**
 * Round-robin assignment by equal distribution: among the hosts free at the chosen time, pick the one with the
 * fewest confirmed bookings of this event type in the last ROUND_ROBIN_WINDOW_DAYS. Ties go to whoever was
 * assigned longest ago (never assigned first), then to the lowest id so the result is deterministic.
 * Cancelled bookings don't count toward the load, so a host whose meetings are cancelled catches up.
 */

export const ROUND_ROBIN_WINDOW_DAYS = 30;

export interface HostLoad {
  hostId: string;
  /** Confirmed bookings of this event type created inside the window. */
  recentCount: number;
  /** Most recent assignment for this event type, in any status; null if never assigned. */
  lastAssignedAt: Date | null;
}

export function pickHost(loads: HostLoad[]): string {
  if (loads.length === 0) throw new Error("pickHost needs at least one candidate");
  const ranked = [...loads].sort(
    (a, b) =>
      a.recentCount - b.recentCount ||
      (a.lastAssignedAt?.getTime() ?? -Infinity) - (b.lastAssignedAt?.getTime() ?? -Infinity) ||
      (a.hostId < b.hostId ? -1 : a.hostId > b.hostId ? 1 : 0),
  );
  return ranked[0].hostId;
}
