// Admin account changes against the dev Postgres, with billing enforced and the Stripe API replaced by a recorder.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  const updates: { id: string; params: any }[] = [];
  const client = {
    subscriptions: {
      retrieve: async (id: string) => ({ id, metadata: { userId: "u", plan: "team", seats: "3" }, items: { data: [{ id: "si_yearly", quantity: 3, price: { recurring: { interval: "year" } } }] } }),
      update: async (id: string, params: any) => {
        updates.push({ id, params });
        return {};
      },
    },
  };
  return { client, updates };
});

vi.mock("@/lib/config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/config")>();
  const prices = { setup: "price_setup", yearly: "price_yearly" };
  return { ...mod, config: { ...mod.config, adminEmails: ["boss@admin.test"], stripe: { secretKey: "sk", webhookSecret: "wh", prices: { solo: prices, team: prices } } } };
});
vi.mock("@/lib/billing/stripe", async (importOriginal) => ({ ...(await importOriginal<object>()), stripe: () => fake.client }));

import { eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { users } from "@/db/schema";
import { canAcceptBookings, seatLimit } from "@/lib/billing/access";
import { acceptsBookings, createTeam, hasPaidFeatures, type Team } from "@/lib/teams";
import { fixtures, type User } from "@/lib/teams/test-fixtures";
import { AdminError, removeTeamMember, revokeTeamInvite, setBonusSeats, setPaidSeats, setPlanAndBilling, setSuspended } from "./manage";

const fx = fixtures("adminmanage");
const admin = { email: "boss@admin.test" } as User;
let owner: User;
let team: Team;
let bob: User;
let cy: User;
const reload = async () => (await db.select().from(users).where(eq(users.id, owner.id)))[0];

beforeAll(async () => {
  owner = await fx.makeUser("own");
  await sql`UPDATE users SET trial_ends_at = now() + interval '7 days' WHERE id = ${owner.id}`;
  owner = await reload();
  team = await createTeam(owner, "Admin Test", `adm-${fx.run}`);
  bob = await fx.makeUser("bob");
  cy = await fx.makeUser("cy");
  await sql`INSERT INTO team_members (team_id, user_id) VALUES (${team.id}, ${bob.id}), (${team.id}, ${cy.id})`;
});

afterAll(async () => {
  await fx.cleanup();
  await sql.end();
});

describe("admin account changes", () => {
  it("are refused for anyone not in ADMIN_EMAILS", async () => {
    await expect(setBonusSeats(owner, owner.id, 3)).rejects.toThrow("Not allowed");
    await expect(setSuspended(bob, owner.id, true)).rejects.toBeInstanceOf(AdminError);
  });

  it("free seats and a comped plan, never fewer seats than team members", async () => {
    // Comped Team plan includes 1 seat; the team has 3 members.
    await expect(setPlanAndBilling(admin, owner.id, { plan: "team", status: "comped" })).rejects.toThrow("3 members");
    await setBonusSeats(admin, owner.id, 2);
    await setPlanAndBilling(admin, owner.id, { plan: "team", status: "comped" });
    const u = await reload();
    expect(u).toMatchObject({ plan: "team", billingStatus: "active", bonusSeats: 2 });
    expect(seatLimit(u)).toBe(3);
    await expect(setBonusSeats(admin, owner.id, 1)).rejects.toThrow("Remove members first");
    await expect(setBonusSeats(admin, owner.id, -1)).rejects.toBeInstanceOf(AdminError);

    // Back to a trial (no seat limit) until a date.
    const end = new Date(Date.now() + 30 * 86_400_000);
    await setPlanAndBilling(admin, owner.id, { plan: "solo", status: "trial", trialEndsAt: end });
    expect(await reload()).toMatchObject({ plan: "solo", billingStatus: "trialing", trialEndsAt: end });
  });

  it("paid seats go through Stripe: more are charged now with the setup fee, fewer are credited", async () => {
    await sql`UPDATE users SET stripe_subscription_id = 'sub_admin_test', billing_status = 'active', plan = 'team', seats = 3, bonus_seats = 0 WHERE id = ${owner.id}`;
    await setPaidSeats(admin, owner.id, 5);
    expect(fake.updates.at(-1)).toEqual({
      id: "sub_admin_test",
      params: {
        items: [{ id: "si_yearly", quantity: 5 }],
        metadata: { userId: "u", plan: "team", seats: "5" },
        add_invoice_items: [{ price: "price_setup", quantity: 2 }],
        proration_behavior: "always_invoice",
      },
    });
    expect((await reload()).seats).toBe(5);

    await setPaidSeats(admin, owner.id, 3);
    expect(fake.updates.at(-1)!.params).toMatchObject({ items: [{ id: "si_yearly", quantity: 3 }], proration_behavior: "create_prorations" });
    expect(fake.updates.at(-1)!.params.add_invoice_items).toBeUndefined();

    // Below the 3 members, or plan changes while Stripe owns billing: refused, and Stripe isn't called.
    const calls = fake.updates.length;
    await expect(setPaidSeats(admin, owner.id, 2)).rejects.toThrow("Remove members first");
    await expect(setPlanAndBilling(admin, owner.id, { plan: "solo", status: "comped" })).rejects.toThrow("Stripe");
    expect(fake.updates.length).toBe(calls);
  });

  it("suspending closes the booking pages, and stops the owner's Team seats covering members", async () => {
    expect(await acceptsBookings(await reload())).toBe(true);
    await sql`UPDATE users SET billing_status = 'free' WHERE id = ${bob.id}`;
    const bobNow = (await db.select().from(users).where(eq(users.id, bob.id)))[0];
    expect(await hasPaidFeatures(bobNow)).toBe(true); // covered by the owner's Team seats

    await setSuspended(admin, owner.id, true);
    const u = await reload();
    expect(u.suspendedAt).toBeInstanceOf(Date);
    expect(canAcceptBookings(u)).toBe(false);
    expect(await acceptsBookings(u)).toBe(false);
    // Bob is back on Free: his own page stays open, without the paid features.
    expect(await acceptsBookings(bobNow)).toBe(true);
    expect(await hasPaidFeatures(bobNow)).toBe(false);

    await setSuspended(admin, owner.id, false);
    expect(await acceptsBookings(await reload())).toBe(true);
  });

  it("removes team members and revokes invites, but never the owner", async () => {
    const [inv] = await sql`INSERT INTO team_invites (team_id, email, token_hash, expires_at) VALUES (${team.id}, 'dee@example.test', ${`h-${fx.run}`}, now() + interval '1 day') RETURNING id`;
    await revokeTeamInvite(admin, owner.id, inv.id);
    expect(await sql`SELECT 1 FROM team_invites WHERE id = ${inv.id}`).toHaveLength(0);

    await removeTeamMember(admin, owner.id, cy.id);
    expect((await sql`SELECT user_id FROM team_members WHERE team_id = ${team.id}`).map((r) => r.user_id).sort()).toEqual([bob.id, owner.id].sort());
    await expect(removeTeamMember(admin, owner.id, owner.id)).rejects.toThrow("owner");
    await expect(removeTeamMember(admin, bob.id, cy.id)).rejects.toThrow("doesn't own a team");
  });
});
