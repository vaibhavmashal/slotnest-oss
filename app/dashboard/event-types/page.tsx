import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { eventTypes } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { bookableEventTypeIds, ownedTeam } from "@/lib/teams";
import { formatPrice } from "@/lib/payments/currencies";

export default async function EventTypes({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const user = await requireUser();
  const { saved } = await searchParams;
  const team = await ownedTeam(user.id);
  const bookable = await bookableEventTypeIds(user);
  // Free plan: which personal event types are switched on but not taking bookings.
  const paused = (e: { id: string; isActive: boolean; priceAmount: number | null; teamId: string | null }) =>
    bookable !== "all" && !e.teamId && e.isActive && (!bookable.has(e.id) || !!e.priceAmount);
  const personal = await db
    .select()
    .from(eventTypes)
    .where(and(eq(eventTypes.userId, user.id), isNull(eventTypes.teamId)))
    .orderBy(asc(eventTypes.createdAt));
  const teamRows = team ? await db.select().from(eventTypes).where(eq(eventTypes.teamId, team.id)).orderBy(asc(eventTypes.createdAt)) : [];
  const rows = [
    ...personal.map((e) => ({ e, handle: user.username, label: null as string | null })),
    ...teamRows.map((e) => ({ e, handle: team!.slug, label: `${team!.name} · ${e.scheduling === "collective" ? "collective" : "round-robin"}` })),
  ];

  return (
    <>
      {saved && <p className="notice">Saved.</p>}
      {bookable !== "all" && (
        <p className="notice">
          You&apos;re on the Free plan: one event type takes bookings. <Link href="/dashboard/billing">Upgrade</Link> for unlimited event
          types, teams, routing forms, payments, webhooks and your own branding.
        </p>
      )}
      <section className="panel">
        <div className="row spread">
          <h2>Event types</h2>
          <div className="row">
            {team && (
              <Link className="secondary fit" href="/dashboard/event-types/new?team=1">
                New team event type
              </Link>
            )}
            <Link className="primary fit" href="/dashboard/event-types/new">
              New event type
            </Link>
          </div>
        </div>
        <p className="muted small">
          Your public page lists every event that isn&apos;t hidden: <a href={`${config.appUrl}/${user.username}`}>{`${config.appUrl}/${user.username}`}</a>
          {team && (
            <>
              {" "}· Team: <a href={`${config.appUrl}/${team.slug}`}>{`${config.appUrl}/${team.slug}`}</a>
            </>
          )}
        </p>
        <table className="list">
          <tbody>
            {rows.map(({ e, handle, label }) => {
              const url = `${config.appUrl}/${handle}/${e.slug}`;
              return (
                <tr key={e.id}>
                  <td>
                    <strong>{e.title}</strong> {!e.isActive && <span className="muted">(off)</span>}{" "}
                    {paused(e) && <strong className="danger-text small">Not taking bookings on the Free plan</strong>} {e.isHidden && <span className="muted">(hidden)</span>}{" "}
                    {e.seatsPerSlot > 1 && <span className="muted">(group, up to {e.seatsPerSlot})</span>}{" "}
                    {e.priceAmount && e.priceCurrency && <span className="muted">({formatPrice(e.priceAmount, e.priceCurrency)})</span>}
                    <div className="muted small">
                      {label && <>{label} · </>}
                      {e.durationMinutes} min · <a href={url}>{url}</a>
                    </div>
                    <details className="small">
                      <summary>Embed on your website</summary>
                      <p className="muted">Inline:</p>
                      <pre>{`<div data-slotnest-url="${url}"></div>\n<script src="${config.appUrl}/embed.js" async></script>`}</pre>
                      <p className="muted">Popup button:</p>
                      <pre>{`<button data-slotnest-popup="${url}">Book a call</button>\n<script src="${config.appUrl}/embed.js" async></script>`}</pre>
                    </details>
                  </td>
                  <td className="right">
                    <Link href={`/dashboard/event-types/${e.id}`}>Edit</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
