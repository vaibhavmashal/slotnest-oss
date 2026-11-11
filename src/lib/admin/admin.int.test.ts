// The admin queries against the dev Postgres, with ADMIN_EMAILS set to one fixture user.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";

vi.mock("@/lib/config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/config")>();
  return { ...mod, config: { ...mod.config, adminEmails: ["boss@admin.test"] } };
});

import { db, sql } from "@/db/client";
import { eventTypes } from "@/db/schema";
import { createBooking } from "@/lib/booking/service";
import { boss } from "@/lib/jobs/queue";
import { fixtures, type User } from "@/lib/teams/test-fixtures";
import { adminBookings, adminStats, adminUsers, isAdmin } from "./index";

const fx = fixtures("admin");
let host: User;

beforeAll(async () => {
  host = await fx.makeUser("adm");
  const [schedule] = await sql`SELECT id FROM schedules WHERE user_id = ${host.id}`;
  await db.insert(eventTypes).values({ userId: host.id, scheduleId: schedule.id, slug: "intro", title: "Intro call", durationMinutes: 30, minimumNoticeMinutes: 0 });
  const start = DateTime.utc().plus({ days: 2 }).set({ hour: 15, minute: 0, second: 0, millisecond: 0 }).toISO()!;
  await createBooking({ handle: host.username, slug: "intro", start, inviteeName: "Eve Eastern", inviteeEmail: `eve-${fx.run}@example.test`, inviteeTimeZone: "America/New_York" });
});

afterAll(async () => {
  await fx.cleanup();
  await (await boss()).stop({ graceful: false });
  await sql.end();
});

describe("admin", () => {
  it("only lets listed emails in, ignoring case", () => {
    expect(isAdmin({ email: "Boss@Admin.test" })).toBe(true);
    expect(isAdmin(host)).toBe(false);
  });

  it("counts accounts and bookings", async () => {
    const s = await adminStats();
    expect(s.users).toBeGreaterThanOrEqual(1);
    expect(s.upcoming).toBeGreaterThanOrEqual(1);
    expect(s.newThisWeek).toBeGreaterThanOrEqual(1);
  });

  it("lists and searches accounts with their booking counts", async () => {
    const [a] = await adminUsers(fx.run);
    expect(a).toMatchObject({ id: host.id, eventTypes: 1, bookings: 1, calendars: [] });
    expect(a.lastBookedAt).toBeInstanceOf(Date);
    expect(await adminUsers(`nobody-${fx.run}`)).toEqual([]);
  });

  it("lists and searches bookings with the invitee's and host's time zones", async () => {
    const found = await adminBookings(`eve-${fx.run}`);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ inviteeName: "Eve Eastern", inviteeTimeZone: "America/New_York", hostTimeZone: "UTC", title: "Intro call" });
    // Searching by the host finds their bookings too.
    expect(await adminBookings(host.email)).toHaveLength(1);
  });
});
