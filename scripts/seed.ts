// Dev seed:
// - Host "at20" (host@example.test) in New York, Mon–Fri 09:00–17:00, with a 30-minute fit call.
// - A second member "sam" (sam@example.test) in London, Mon–Fri 09:00–17:00.
// - Team "at20-sales", owned by at20, with a round-robin 30-minute demo shared by both, and a collective
//   45-minute kickoff that both attend (only 14:00–17:00 UTC overlaps).
import { existsSync } from "node:fs";
import postgres from "postgres";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

async function defaultSchedule(tx: postgres.TransactionSql, userId: string, timeZone: string) {
  const [existing] = await tx`SELECT id FROM schedules WHERE user_id = ${userId} AND is_default`;
  return (
    existing?.id ??
    (await tx`INSERT INTO schedules (user_id, name, time_zone, is_default)
              VALUES (${userId}, 'Working hours', ${timeZone}, true) RETURNING id`)[0].id
  );
}

await sql.begin(async (tx) => {
  const [user] = await tx`
    INSERT INTO users (email, name, username, time_zone)
    VALUES ('host@example.test', 'AT20 Team', 'at20', 'America/New_York')
    ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  const scheduleId = await defaultSchedule(tx, user.id, "America/New_York");
  await tx`DELETE FROM availability_rules WHERE schedule_id = ${scheduleId}`;
  for (const weekday of [1, 2, 3, 4, 5]) {
    await tx`INSERT INTO availability_rules (schedule_id, weekday, start_minute, end_minute)
             VALUES (${scheduleId}, ${weekday}, ${9 * 60}, ${17 * 60})`;
  }
  await tx`
    INSERT INTO event_types (user_id, schedule_id, slug, title, description, duration_minutes,
                             buffer_after_minutes, minimum_notice_minutes, booking_window_days, location_kind)
    VALUES (${user.id}, ${scheduleId}, 'fit-call', 'Fit call',
            'A 30-minute call to see whether the AT20 program fits your team.', 30, 10, 240, 30, 'google_meet')
    ON CONFLICT (user_id, slug) WHERE team_id IS NULL DO NOTHING`;
});

await sql.begin(async (tx) => {
  const [owner] = await tx`SELECT id FROM users WHERE username = 'at20'`;
  const [sam] = await tx`
    INSERT INTO users (email, name, username, time_zone)
    VALUES ('sam@example.test', 'Sam Patel', 'sam', 'Europe/London')
    ON CONFLICT (username) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;
  const samSchedule = await defaultSchedule(tx, sam.id, "Europe/London");
  const [rules] = await tx`SELECT count(*)::int AS n FROM availability_rules WHERE schedule_id = ${samSchedule}`;
  if (rules.n === 0) {
    for (const weekday of [1, 2, 3, 4, 5]) {
      await tx`INSERT INTO availability_rules (schedule_id, weekday, start_minute, end_minute)
               VALUES (${samSchedule}, ${weekday}, ${9 * 60}, ${17 * 60})`;
    }
  }
  const [team] = await tx`
    INSERT INTO teams (slug, name, owner_id) VALUES ('at20-sales', 'AT20 Sales', ${owner.id})
    ON CONFLICT (owner_id) DO UPDATE SET name = teams.name
    RETURNING id`;
  await tx`INSERT INTO team_members (team_id, user_id, role) VALUES (${team.id}, ${owner.id}, 'owner'), (${team.id}, ${sam.id}, 'member')
           ON CONFLICT DO NOTHING`;
  const [demo] = await tx`
    INSERT INTO event_types (user_id, team_id, scheduling, slug, title, description, duration_minutes,
                             minimum_notice_minutes, booking_window_days, location_kind)
    VALUES (${owner.id}, ${team.id}, 'round_robin', 'demo', 'Product demo',
            'A 30-minute demo with the next available member of the AT20 sales team.', 30, 240, 30, 'google_meet')
    ON CONFLICT (team_id, slug) WHERE team_id IS NOT NULL DO UPDATE SET title = event_types.title
    RETURNING id`;
  await tx`INSERT INTO event_type_hosts (event_type_id, user_id) VALUES (${demo.id}, ${owner.id}), (${demo.id}, ${sam.id})
           ON CONFLICT DO NOTHING`;
  const [kickoff] = await tx`
    INSERT INTO event_types (user_id, team_id, scheduling, slug, title, description, duration_minutes,
                             minimum_notice_minutes, booking_window_days, location_kind)
    VALUES (${owner.id}, ${team.id}, 'collective', 'kickoff', 'Project kickoff',
            'A 45-minute kickoff with both of our leads.', 45, 240, 30, 'google_meet')
    ON CONFLICT (team_id, slug) WHERE team_id IS NOT NULL DO UPDATE SET title = event_types.title
    RETURNING id`;
  await tx`INSERT INTO event_type_hosts (event_type_id, user_id) VALUES (${kickoff.id}, ${owner.id}), (${kickoff.id}, ${sam.id})
           ON CONFLICT DO NOTHING`;
});
console.log("seeded: http://localhost:3100/at20/fit-call, /at20-sales/demo (round-robin) and /at20-sales/kickoff (collective)");
await sql.end();
