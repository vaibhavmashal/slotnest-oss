import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { availabilityRules, dateOverrides, schedules } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import TimeZoneSelect from "@/components/TimeZoneSelect";
import { addOverride, removeOverride, saveAvailability } from "../actions";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function Availability({ searchParams }: { searchParams: Promise<{ saved?: string; error?: string }> }) {
  const user = await requireUser();
  const q = await searchParams;
  const [schedule] = await db.select().from(schedules).where(and(eq(schedules.userId, user.id), eq(schedules.isDefault, true)));
  const rules = await db.select().from(availabilityRules).where(eq(availabilityRules.scheduleId, schedule.id));
  const overrides = await db.select().from(dateOverrides).where(eq(dateOverrides.scheduleId, schedule.id)).orderBy(asc(dateOverrides.date));
  const byDay = new Map(rules.map((r) => [r.weekday, r]));

  return (
    <>
      {q.saved && <p className="notice">Saved.</p>}
      {q.error && <p className="error">Please check the times (start must be before end).</p>}
      <section className="panel">
        <h2>Weekly hours</h2>
        <form action={saveAvailability} className="stack">
          <label className="row">
            <span>Time zone</span>
            <TimeZoneSelect name="timeZone" defaultValue={schedule.timeZone} />
          </label>
          {DAYS.map((name, i) => {
            const d = i + 1;
            const r = byDay.get(d);
            return (
              <div key={d} className="row">
                <label className="day">
                  <input type="checkbox" name={`on-${d}`} defaultChecked={!!r} /> {name}
                </label>
                <input type="time" name={`start-${d}`} defaultValue={hhmm(r?.startMinute ?? 540)} step={900} />
                <span>–</span>
                <input type="time" name={`end-${d}`} defaultValue={r?.endMinute === 1440 ? "23:59" : hhmm(r?.endMinute ?? 1020)} step={900} />
              </div>
            );
          })}
          <button className="primary fit" type="submit">
            Save hours
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Date overrides</h2>
        <p className="muted small">Holidays or one-off changes. An override replaces your weekly hours for that date.</p>
        {overrides.length > 0 && (
          <table className="list">
            <tbody>
              {[...new Map(overrides.map((o) => [o.date, overrides.filter((x) => x.date === o.date)])).entries()].map(([date, rows]) => (
                <tr key={date}>
                  <td>
                    <strong>{date}</strong>{" "}
                    <span className="muted">
                      {rows.every((r) => r.startMinute === null) ? "Unavailable" : rows.map((r) => `${hhmm(r.startMinute!)}–${hhmm(r.endMinute!)}`).join(", ")}
                    </span>
                  </td>
                  <td className="right">
                    <form action={removeOverride}>
                      <input type="hidden" name="date" value={date} />
                      <button className="link inline danger-text" type="submit">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form action={addOverride} className="row wrap">
          <input type="date" name="date" required />
          <label className="day">
            <input type="checkbox" name="unavailable" defaultChecked /> Unavailable all day
          </label>
          <span className="muted small">or hours:</span>
          <input type="time" name="start" defaultValue="09:00" step={900} />
          <span>–</span>
          <input type="time" name="end" defaultValue="13:00" step={900} />
          <button className="secondary" type="submit">
            Add override
          </button>
        </form>
      </section>
    </>
  );
}
