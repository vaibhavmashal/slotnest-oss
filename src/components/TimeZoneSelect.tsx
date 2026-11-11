"use client";

import { useEffect, useMemo, useState } from "react";
import { canonicalZone, zoneGroups } from "@/lib/timezones";

/**
 * Grouped <option>s for a time-zone <select>: `pinned` first (the browser's or saved zone), then by region and country.
 * Before mount (`ready` false) only `value` is rendered: offsets and country names come from the browser, not the server.
 */
export function ZoneOptions({ value, pinned, pinnedLabel, ready }: { value: string; pinned: string; pinnedLabel?: string; ready: boolean }) {
  const groups = useMemo(() => (ready ? zoneGroups(pinned, pinnedLabel) : null), [ready, pinned, pinnedLabel]);
  if (!groups) return <option value={value}>{value.replaceAll("_", " ")}</option>;
  return groups.map((g) => (
    <optgroup key={g.label} label={g.label}>
      {g.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </optgroup>
  ));
}

/** Time-zone picker that defaults to the browser's zone (filled in after mount to avoid hydration mismatches). */
export default function TimeZoneSelect({ name, defaultValue }: { name: string; defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue ?? "UTC");
  const [pinned, setPinned] = useState(value);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const initial = canonicalZone(defaultValue ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    setValue(initial);
    setPinned(initial);
    setReady(true);
  }, [defaultValue]);
  return (
    <select name={name} value={value} onChange={(e) => setValue(e.target.value)}>
      <ZoneOptions value={value} pinned={pinned} pinnedLabel={defaultValue ? "Current" : "Your time zone"} ready={ready} />
    </select>
  );
}
