// Prices for paid bookings: supported currencies, parsing and formatting. No server dependencies.

/** Currencies hosts can charge in (all with two decimal places). */
export const CURRENCIES = ["usd", "eur", "gbp", "inr", "cad", "aud", "sgd", "aed", "chf", "nzd"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** Smallest amount Stripe accepts per currency, in cents (roughly 0.50 USD). */
const MINIMUM: Partial<Record<Currency, number>> = { inr: 5000, aed: 200, gbp: 30 };
export const minimumAmount = (c: Currency) => MINIMUM[c] ?? 50;

/** "$50.00", "₹1,500.00". */
export function formatPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);
}

/** Parse "50" or "49.99" into cents for a currency; null if it isn't a valid price. */
export function parsePrice(input: string, currency: string): number | null {
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(input.trim())) return null;
  const cents = Math.round(Number(input) * 100);
  if (!(CURRENCIES as readonly string[]).includes(currency) || cents < minimumAmount(currency as Currency)) return null;
  return cents;
}
