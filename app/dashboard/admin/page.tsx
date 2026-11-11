import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { ADMIN_LIMIT, adminBookings, adminStats, adminUsers, isAdmin } from "@/lib/admin";
import { requireUser } from "@/lib/auth/session";
import { planName } from "@/lib/billing/access";
import { formatWhen } from "@/lib/email/templates";

export const metadata = { title: "Admin · Slotnest" };

const day = (d: Date, tz: string) => DateTime.fromJSDate(d).setZone(tz).toFormat("d LLL yyyy");
const money = (amount: number, currency: string) =>
  new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).format(amount / 100);

export default async function Admin({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  // Not listed in ADMIN_EMAILS: behave as if there's no such page.
  if (!isAdmin(user)) notFound();
  const q = (await searchParams).q?.trim().slice(0, 100) || undefined;
  const [stats, accounts, recent] = await Promise.all([adminStats(), adminUsers(q), adminBookings(q)]);
  const tz = user.timeZone;
  const now = new Date();

  return (
    <>
      <section className="panel">
        <h2>Admin</h2>
        <div className="admin-stats">
          {[
            ["Accounts", stats.users, `${stats.newThisWeek} new this week`],
            ["Paying", stats.paying, `${stats.free} on Free, ${stats.trialing} in trial`],
            ["Bookings", stats.bookings, `${stats.bookedThisWeek} made this week`],
            ["Upcoming", stats.upcoming, `${stats.cancelled} cancelled in all`],
          ].map(([label, n, sub]) => (
            <div key={label}>
              <span className="muted small">{label}</span>
              <strong>{n}</strong>
              <span className="muted small">{sub}</span>
            </div>
          ))}
        </div>
        <form className="admin-search">
          <input name="q" type="search" defaultValue={q} placeholder="Search by name or email" aria-label="Search accounts and bookings" />
          <button className="secondary" type="submit">
            Search
          </button>
          {q && <a href="/dashboard/admin">Clear</a>}
        </form>
      </section>

      <section className="panel">
        <h2>Accounts{q && ` matching “${q}”`}</h2>
        {accounts.length === 0 ? (
          <p className="muted">No accounts{q ? " match" : " yet"}.</p>
        ) : (
          <table className="list">
            <tbody>
              {accounts.map((a) => {
                return (
                  <tr key={a.id}>
                    <td>
                      <Link href={`/dashboard/admin/${a.id}`}>
                        <strong>{a.name}</strong>
                      </Link>{" "}
                      <span className="muted">&lt;{a.email}&gt;</span>
                      {a.suspended && <strong className="danger-text small"> suspended</strong>}
                      <div className="muted small">
                        /{a.username} · {a.timeZone.replaceAll("_", " ")} · joined {day(a.createdAt, tz)} · {a.calendars.length ? a.calendars.join(", ") : "no calendar"}
                        {a.stripePayouts && " · takes payments"}
                      </div>
                    </td>
                    <td className="right small">
                      {planName(a, now) === "Free"
                        ? "Free"
                        : planName(a, now) === "Trial"
                          ? `Trial to ${day(a.trialEndsAt, tz)}`
                          : `${a.plan === "team" ? `Team, ${a.seats + a.bonusSeats} seats` : "Solo"} · ${a.billingStatus.replace("_", " ")}`}
                      <div className="muted">
                        {a.eventTypes} event {a.eventTypes === 1 ? "type" : "types"} · {a.bookings} {a.bookings === 1 ? "booking" : "bookings"}
                        {a.lastBookedAt && `, last ${day(a.lastBookedAt, tz)}`}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {accounts.length === ADMIN_LIMIT && <p className="muted small">Showing the newest {ADMIN_LIMIT}. Search to find others.</p>}
      </section>

      <section className="panel">
        <h2>Recent bookings{q && ` matching “${q}”`}</h2>
        <p className="muted small">Newest first. The first line is the time as the invitee saw it, in the time zone their browser chose.</p>
        {recent.length === 0 ? (
          <p className="muted">No bookings{q ? " match" : " yet"}.</p>
        ) : (
          <table className="list">
            <tbody>
              {recent.map((b) => (
                <tr key={b.id}>
                  <td>
                    <strong>{formatWhen(b.startAt, b.endAt, b.inviteeTimeZone)}</strong>
                    <div className="muted small">
                      Host time: {formatWhen(b.startAt, b.endAt, b.hostTimeZone)}
                      <br />
                      {b.title} · {b.inviteeName} &lt;{b.inviteeEmail}&gt; booked {b.hostName} &lt;{b.hostEmail}&gt; on {day(b.createdAt, tz)}
                    </div>
                  </td>
                  <td className="right small">
                    {b.status}
                    {b.paymentAmount !== null && b.paymentCurrency && (
                      <div className="muted">
                        {money(b.paymentAmount, b.paymentCurrency)} {b.paymentStatus}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {recent.length === ADMIN_LIMIT && <p className="muted small">Showing the newest {ADMIN_LIMIT}. Search to find others.</p>}
      </section>
    </>
  );
}
