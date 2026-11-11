// Fixtures for the team integration tests: throwaway users with UTC schedules, removed again by cleanup().
import { eq } from "drizzle-orm";
import { db, sql } from "@/db/client";
import { users } from "@/db/schema";

export type User = typeof users.$inferSelect;

export function fixtures(prefix: string) {
  const run = `${prefix}-${Date.now().toString(36)}`;
  const created: string[] = [];

  /** A user in a running trial (every feature) whose default schedule is every day from startHour to endHour UTC. */
  async function makeUser(name: string, startHour = 0, endHour = 24): Promise<User> {
    const [u] = await sql`
      INSERT INTO users (email, name, username, time_zone, billing_status, trial_ends_at)
      VALUES (${`${name}-${run}@example.test`}, ${name}, ${`${name}-${run}`}, 'UTC', 'trialing', now() + interval '14 days') RETURNING id`;
    created.push(u.id);
    const [s] = await sql`INSERT INTO schedules (user_id, name, time_zone, is_default) VALUES (${u.id}, 'Hours', 'UTC', true) RETURNING id`;
    for (const weekday of [1, 2, 3, 4, 5, 6, 7]) {
      await sql`INSERT INTO availability_rules (schedule_id, weekday, start_minute, end_minute)
                VALUES (${s.id}, ${weekday}, ${startHour * 60}, ${endHour * 60})`;
    }
    const [user] = await db.select().from(users).where(eq(users.id, u.id));
    return user;
  }

  /** Delete everything the fixture users own, including bookings and their queued jobs. */
  async function cleanup() {
    if (!created.length) return;
    const ids = (await sql`SELECT DISTINCT booking_id FROM booking_hosts WHERE host_id = ANY(${created})`).map((r) => r.booking_id);
    if (ids.length) {
      await sql`DELETE FROM pgboss.job WHERE data->>'bookingId' = ANY(${ids})`;
      await sql`DELETE FROM bookings WHERE id = ANY(${ids})`;
    }
    await sql`DELETE FROM users WHERE id = ANY(${created})`; // cascades teams, event types, memberships
  }

  return { run, makeUser, cleanup };
}
