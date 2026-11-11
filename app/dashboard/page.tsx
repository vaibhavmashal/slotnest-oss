import { and, asc, eq, gt, ne } from "drizzle-orm";
import { db } from "@/db/client";
import { bookingHosts, bookings, eventTypes } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { ContactLink } from "@/components/LegalFooter";
import { acceptsBookings } from "@/lib/teams";
import { listConnections } from "@/lib/integrations/connections";
import { isConfigured } from "@/lib/integrations/oauth";
import { formatWhen } from "@/lib/email/templates";
import { countryForZone, countryOptions, paymentsAvailable } from "@/lib/payments";
import { disconnectStripe, hostCancelBooking, updateConnection } from "./actions";

const PROVIDER_LABEL = { google: "Google Calendar", microsoft: "Microsoft 365 / Outlook", zoom: "Zoom" } as const;

const MESSAGES: Record<string, string> = {
  welcome: "Your account is ready. Connect your calendar so bookings avoid your existing meetings.",
  connected: "Connected.",
};

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const q = await searchParams;
  const upcoming = await db
    .select({ booking: bookings, title: eventTypes.title })
    .from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    // Meetings this user hosts, including collective meetings they're part of.
    .innerJoin(bookingHosts, and(eq(bookingHosts.bookingId, bookings.id), eq(bookingHosts.hostId, user.id)))
    // Paid bookings appear once paid; an unpaid hold isn't a meeting yet.
    .where(and(eq(bookings.status, "confirmed"), gt(bookings.endAt, new Date()), ne(bookings.paymentStatus, "pending")))
    .orderBy(asc(bookings.startAt))
    .limit(50);
  const connections = await listConnections(user.id);
  const accepting = await acceptsBookings(user);

  return (
    <>
      {q.welcome && <p className="notice">{MESSAGES.welcome}</p>}
      {q.payments === "connected" && <p className="notice">Stripe connected. You can now set prices on your event types.</p>}
      {q.payments === "pending" && <p className="notice">Stripe needs a few more details before your account can take payments. Use &ldquo;Finish Stripe setup&rdquo; below.</p>}
      {q.payments === "country" && <p className="error">Choose the country your business is based in, then connect Stripe.</p>}
      {q.payments === "error" &&<p className="error">Couldn&apos;t reach Stripe. Please try again.</p>}
      {q.connected && <p className="notice">{PROVIDER_LABEL[q.connected as keyof typeof PROVIDER_LABEL] ?? q.connected} connected.</p>}
      {q.error && (
        <p className="error">
          {q.error.endsWith("_not_configured")
            ? "This integration isn't configured on the server yet (missing OAuth credentials, see SETUP.md)."
            : `Could not connect (${q.error}). Please try again.`}
        </p>
      )}
      {!accepting && (
        <p className="error">
          Your account is suspended, so your booking pages are off. Contact <ContactLink />.
        </p>
      )}

      <section className="panel">
        <h2>Upcoming meetings</h2>
        {upcoming.length === 0 ? (
          <p className="muted">No upcoming meetings yet.</p>
        ) : (
          <table className="list">
            <tbody>
              {upcoming.map(({ booking: b, title }) => (
                <tr key={b.id}>
                  <td>
                    <strong>{formatWhen(b.startAt, b.endAt, user.timeZone)}</strong>
                    <div className="muted small">
                      {title} · {b.inviteeName} &lt;{b.inviteeEmail}&gt;
                      {b.meetingUrl && (
                        <>
                          {" "}
                          · <a href={b.meetingUrl}>join link</a>
                        </>
                      )}
                    </div>
                    {b.answers.length > 0 && (
                      <div className="muted small">
                        {b.answers.map((a) => (
                          <div key={a.id}>
                            {a.label}: {a.value}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="right">
                    <form action={hostCancelBooking}>
                      <input type="hidden" name="id" value={b.id} />
                      <button className="secondary small" type="submit">
                        Cancel
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Calendars and video</h2>
        <p className="muted small">
          Busy times from calendars marked “check for conflicts” are hidden from your booking pages. New bookings are added to your
          “add bookings to” calendar.
        </p>
        {connections.length > 0 && (
          <table className="list">
            <tbody>
              {connections.map((c) => (
                <tr key={c.id}>
                  <td>
                    <strong>{PROVIDER_LABEL[c.provider]}</strong> · {c.accountEmail}
                    {c.lastError && <div className="error small">Last error: {c.lastError}</div>}
                  </td>
                  <td className="right nowrap">
                    {c.provider !== "zoom" && (
                      <>
                        <form action={updateConnection} className="inline">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="op" value="toggle-conflicts" />
                          <button className="link inline" type="submit">
                            {c.checkForConflicts ? "✓ Check for conflicts" : "Not checking conflicts"}
                          </button>
                        </form>
                        {" · "}
                        {c.isWriteTarget ? (
                          <span className="muted">Adds bookings here</span>
                        ) : (
                          <form action={updateConnection} className="inline">
                            <input type="hidden" name="id" value={c.id} />
                            <input type="hidden" name="op" value="make-write-target" />
                            <button className="link inline" type="submit">
                              Add bookings here
                            </button>
                          </form>
                        )}
                        {" · "}
                      </>
                    )}
                    <form action={updateConnection} className="inline">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="op" value="disconnect" />
                      <button className="link inline danger-text" type="submit">
                        Disconnect
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="actions left">
          {(["google", "microsoft", "zoom"] as const).map((p) => (
            <a key={p} className="secondary" href={`/api/integrations/${p}/connect`} aria-disabled={!isConfigured(p)}>
              Connect {PROVIDER_LABEL[p]}
              {!isConfigured(p) && " (not configured)"}
            </a>
          ))}
        </div>
      </section>

      {paymentsAvailable() && (
        <section className="panel" id="payments">
          <h2>Payments</h2>
          {user.stripeChargesEnabled ? (
            <>
              <p>
                <span className="ok">Stripe connected.</span> You can set a price on any event type; invitees pay when they book and
                the money goes to your Stripe account.
              </p>
              <div className="actions left">
                <a className="secondary" href="https://dashboard.stripe.com" target="_blank" rel="noopener">
                  Open Stripe dashboard
                </a>
                <form action={disconnectStripe} className="inline">
                  <button className="link inline danger-text" type="submit">
                    Disconnect
                  </button>
                </form>
              </div>
            </>
          ) : (
            <>
              <p className="muted">
                Charge for bookings: connect a Stripe account and set a price on an event type. Payments go straight to you;
                Slotnest takes no cut.
                {user.stripeAccountId && " Stripe still needs a few details before your account can take payments."}
              </p>
              {user.stripeAccountId ? (
                <div className="actions left">
                  <a className="primary" href="/api/payments/connect">
                    Finish Stripe setup
                  </a>
                </div>
              ) : (
                <form action="/api/payments/connect" method="get" className="connect-stripe">
                  <label>
                    Your business is based in
                    <select name="country" defaultValue={countryForZone(user.timeZone) ?? "US"}>
                      {countryOptions().map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary" type="submit">
                    Connect Stripe
                  </button>
                  <p className="muted small">
                    Country not listed? Stripe doesn&rsquo;t let Slotnest take payments for businesses there yet (that includes
                    India). Your free bookings work everywhere.
                  </p>
                </form>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
