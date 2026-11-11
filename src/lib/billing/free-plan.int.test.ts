// The Free plan against the dev Postgres, with billing enforced (Stripe "configured"; no Stripe calls are made).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";

vi.mock("@/lib/config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/config")>();
  const prices = { setup: "price_setup", yearly: "price_yearly" };
  return { ...mod, config: { ...mod.config, stripe: { secretKey: "sk", webhookSecret: "wh", prices: { solo: prices, team: prices } } } };
});

import { eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { eventTypes, users } from "@/db/schema";
import { createBooking, getPublicProfile, getSlots } from "@/lib/booking/service";
import { boss } from "@/lib/jobs/queue";
import { hasPaidFeatures } from "@/lib/teams";
import { teamPlanAllows } from "./access";
import { fixtures, type User } from "@/lib/teams/test-fixtures";

const fx = fixtures("free");
let host: User;
const reload = async () => (await db.select().from(users).where(eq(users.id, host.id)))[0];
const window = () => [DateTime.utc().plus({ days: 1 }).startOf("day").toISO()!, DateTime.utc().plus({ days: 3 }).startOf("day").toISO()!];

beforeAll(async () => {
  host = await fx.makeUser("freehost");
  await sql`UPDATE users SET billing_status = 'free' WHERE id = ${host.id}`;
  host = await reload();
  const [schedule] = await sql`SELECT id FROM schedules WHERE user_id = ${host.id}`;
  const base = { userId: host.id, scheduleId: schedule.id, durationMinutes: 30, minimumNoticeMinutes: 0 };
  // Created in this order: "first" is the one Free keeps bookable.
  await db.insert(eventTypes).values({ ...base, slug: "first", title: "First", createdAt: new Date(Date.now() - 2000) });
  await db.insert(eventTypes).values({ ...base, slug: "second", title: "Second", createdAt: new Date(Date.now() - 1000) });
});

afterAll(async () => {
  await fx.cleanup();
  await (await boss()).stop({ graceful: false });
  await sql.end();
});

describe("Free plan", () => {
  it("has no paid features or teams", async () => {
    expect(await hasPaidFeatures(host)).toBe(false);
    expect(teamPlanAllows(host)).toBe(false);
  });

  it("lists and takes bookings for one event type only", async () => {
    const profile = await getPublicProfile(host.username);
    expect(profile!.eventTypes.map((e) => e.slug)).toEqual(["first"]);

    const [from, to] = window();
    const open = await getSlots(host.username, "first", from, to);
    expect(open.length).toBeGreaterThan(0);
    expect(await getSlots(host.username, "second", from, to)).toEqual([]);

    const booking = { handle: host.username, start: open[0].start, inviteeName: "Ann", inviteeEmail: `ann-${fx.run}@example.test`, inviteeTimeZone: "Asia/Kolkata" };
    await expect(createBooking({ ...booking, slug: "second" })).rejects.toMatchObject({ code: "NOT_ACCEPTING" });
    const made = await createBooking({ ...booking, slug: "first" });
    expect(made.booking.status).toBe("confirmed");
  });

  it("doesn't take payments, and switching the free one off frees the allowance", async () => {
    await sql`UPDATE event_types SET price_amount = 5000, price_currency = 'usd' WHERE user_id = ${host.id} AND slug = 'first'`;
    const [from, to] = window();
    expect(await getSlots(host.username, "first", from, to)).toEqual([]);
    await sql`UPDATE event_types SET price_amount = NULL, price_currency = NULL, is_active = false WHERE user_id = ${host.id} AND slug = 'first'`;
    expect((await getSlots(host.username, "second", from, to)).length).toBeGreaterThan(0);
    await sql`UPDATE event_types SET is_active = true WHERE user_id = ${host.id} AND slug = 'first'`;
  });

  it("unlocks everything on a paid plan", async () => {
    await sql`UPDATE users SET billing_status = 'active', plan = 'solo' WHERE id = ${host.id}`;
    host = await reload();
    expect(await hasPaidFeatures(host)).toBe(true);
    expect((await getPublicProfile(host.username))!.eventTypes.map((e) => e.slug)).toEqual(["first", "second"]);
    const [from, to] = window();
    expect((await getSlots(host.username, "second", from, to)).length).toBeGreaterThan(0);
    expect(teamPlanAllows(host)).toBe(false); // Solo doesn't include teams
  });
});

