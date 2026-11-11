// Time-zone choices grouped by region, then country, with the current UTC offset, so people can find theirs quickly.
import { ZONES_BY_COUNTRY } from "./timezones-data";

export interface ZoneOption {
  value: string;
  label: string;
}
export interface ZoneGroup {
  label: string;
  options: ZoneOption[];
}

/** Old names some browsers still report (Chrome says Asia/Calcutta), mapped to the names in our list. */
const ALIASES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Europe/Kiev": "Europe/Kyiv",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Pacific/Truk": "Pacific/Chuuk",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Etc/UTC": "UTC",
  "Etc/GMT": "UTC",
  GMT: "UTC",
};

export const canonicalZone = (zone: string) => ALIASES[zone] ?? zone;

/**
 * A time zone to store from a form: its current name ("Asia/Calcutta" → "Asia/Kolkata"), or null when it isn't one.
 * Checked by asking Intl to use it: Intl.supportedValuesOf("timeZone") lists the old names only (Asia/Calcutta, not
 * Asia/Kolkata), so checking membership there turned away India, Ukraine, Vietnam, Nepal and Myanmar.
 */
export function cleanZone(input: string): string | null {
  const zone = input.trim();
  if (!zone || zone.length > 64) return null;
  if (zone.toUpperCase() === "UTC") return "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
  } catch {
    return null;
  }
  return canonicalZone(zone);
}

const REGIONS: Record<string, string> = {
  America: "Americas",
  Europe: "Europe",
  Asia: "Asia",
  Africa: "Africa",
  Australia: "Australia & Pacific",
  Pacific: "Australia & Pacific",
  Indian: "Indian Ocean",
  Atlantic: "Atlantic",
  Antarctica: "Antarctica",
  Arctic: "Europe",
};
const REGION_ORDER = ["Americas", "Europe", "Asia", "Africa", "Australia & Pacific", "Indian Ocean", "Atlantic", "Antarctica"];

/** "GMT+5:30" for a zone right now, or null when this browser doesn't know the zone. */
function offsetLabel(zone: string, now: Date): string | null {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName");
    return part ? part.value.replace(/^GMT$/, "GMT+0") : "";
  } catch {
    return null;
  }
}

const city = (zone: string) => zone.slice(zone.lastIndexOf("/") + 1).replaceAll("_", " ");

let countryNames: Intl.DisplayNames | null = null;
function countryName(code: string): string {
  try {
    countryNames ??= new Intl.DisplayNames(["en"], { type: "region" });
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Label for one zone: "India (GMT+5:30)" or "Australia – Sydney (GMT+11)". */
export function zoneLabel(zone: string, now = new Date()): string {
  const z = canonicalZone(zone);
  const offset = offsetLabel(z, now);
  const suffix = offset ? ` (${offset})` : "";
  if (z === "UTC") return `UTC${suffix}`;
  for (const [cc, zones] of Object.entries(ZONES_BY_COUNTRY)) {
    if (zones.includes(z)) return zones.length === 1 ? `${countryName(cc)}${suffix}` : `${countryName(cc)} – ${city(z)}${suffix}`;
  }
  return `${z.replaceAll("_", " ")}${suffix}`;
}

/** All zones, grouped by region and sorted by country then city, with `pinned` (e.g. the browser's zone) listed first. */
export function zoneGroups(pinned: string, pinnedLabel = "Your time zone", now = new Date()): ZoneGroup[] {
  const byRegion = new Map<string, (ZoneOption & { sort: string })[]>();
  for (const [cc, zones] of Object.entries(ZONES_BY_COUNTRY)) {
    const region = REGIONS[zones[0].split("/")[0]] ?? "Other";
    const country = countryName(cc);
    for (const zone of zones) {
      const offset = offsetLabel(zone, now);
      if (offset === null) continue;
      const label = zones.length === 1 ? `${country} (${offset})` : `${country} – ${city(zone)} (${offset})`;
      const list = byRegion.get(region) ?? [];
      list.push({ value: zone, label, sort: label });
      byRegion.set(region, list);
    }
  }
  const top = canonicalZone(pinned);
  const groups: ZoneGroup[] = [{ label: pinnedLabel, options: [{ value: top, label: zoneLabel(top, now) }] }];
  const other = byRegion.get("Other") ?? [];
  byRegion.set("Other", [...other, { value: "UTC", label: "UTC (GMT+0)", sort: "~" }]);
  for (const region of [...REGION_ORDER, "Other"]) {
    const list = byRegion.get(region);
    if (list) groups.push({ label: region, options: list.sort((a, b) => a.sort.localeCompare(b.sort)).map(({ value, label }) => ({ value, label })) });
  }
  return groups;
}
