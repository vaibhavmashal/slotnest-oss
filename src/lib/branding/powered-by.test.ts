import { afterEach, describe, expect, it, vi } from "vitest";

// config.ts reads the environment once at import, so each case loads a fresh module graph.
async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? "");
  vi.stubEnv("DATABASE_URL", "postgres://unused@localhost/unused"); // db client is imported but never queried here
  return import("./index");
}

afterEach(() => vi.unstubAllEnvs());

const STRIPE = { STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" };
const NO_STRIPE = { STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined };

describe("Powered by Slotnest (paid-only hide)", () => {
  it("with billing on: only active or past_due accounts can hide it; trials and cancelled accounts can't", async () => {
    const { canHidePoweredBy, showsPoweredBy } = await load(STRIPE);
    expect(canHidePoweredBy({ billingStatus: "active" })).toBe(true);
    expect(canHidePoweredBy({ billingStatus: "past_due" })).toBe(true);
    expect(canHidePoweredBy({ billingStatus: "trialing" })).toBe(false);
    expect(canHidePoweredBy({ billingStatus: "canceled" })).toBe(false);

    expect(showsPoweredBy({ billingStatus: "active", hidePoweredBy: true })).toBe(false);
    expect(showsPoweredBy({ billingStatus: "active", hidePoweredBy: false })).toBe(true);
    // A paid account that turned it off and then lapsed shows the mark again without any data change.
    expect(showsPoweredBy({ billingStatus: "canceled", hidePoweredBy: true })).toBe(true);
    expect(showsPoweredBy({ billingStatus: "trialing", hidePoweredBy: true })).toBe(true);
  });

  it("with billing off: UNBILLED_PAID_FEATURES decides (default on) so both paths are testable locally", async () => {
    let m = await load({ ...NO_STRIPE, UNBILLED_PAID_FEATURES: undefined });
    expect(m.canHidePoweredBy({ billingStatus: "trialing" })).toBe(true);
    expect(m.showsPoweredBy({ billingStatus: "trialing", hidePoweredBy: true })).toBe(false);

    m = await load({ ...NO_STRIPE, UNBILLED_PAID_FEATURES: "false" });
    expect(m.canHidePoweredBy({ billingStatus: "trialing" })).toBe(false);
    expect(m.showsPoweredBy({ billingStatus: "trialing", hidePoweredBy: true })).toBe(true);
  });
});
