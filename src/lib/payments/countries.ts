// Countries where Stripe lets a business open an account. Stripe needs the country before it can set an account up
// to take payments, so hosts pick one when they connect (pre-filled from their time zone).
// India is left out: Stripe India is invite-only and doesn't take on accounts for platforms outside India.
import { ZONES_BY_COUNTRY } from "@/lib/timezones-data";
import { canonicalZone } from "@/lib/timezones";

export const STRIPE_COUNTRIES = [
  "AE", "AT", "AU", "BE", "BG", "BR", "CA", "CH", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GB", "GI", "GR", "HK",
  "HR", "HU", "IE", "IT", "JP", "LI", "LT", "LU", "LV", "MT", "MX", "MY", "NL", "NO", "NZ", "PL", "PT", "RO", "SE",
  "SG", "SI", "SK", "TH", "US",
] as const;

export const isStripeCountry = (c: unknown): c is string => typeof c === "string" && (STRIPE_COUNTRIES as readonly string[]).includes(c);

/** The Stripe countries with their English names, sorted by name. */
export function countryOptions(): { code: string; name: string }[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return STRIPE_COUNTRIES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name));
}

/** A best guess at the host's country from their time zone, if Stripe supports it. */
export function countryForZone(zone: string): string | null {
  const z = canonicalZone(zone);
  for (const [code, zones] of Object.entries(ZONES_BY_COUNTRY)) {
    if (zones.includes(z)) return isStripeCountry(code) ? code : null;
  }
  return null;
}
