import Link from "next/link";
import { notFound } from "next/navigation";
import { DateTime } from "luxon";
import { isAdmin } from "@/lib/admin";
import { getAccount, MAX_SEATS } from "@/lib/admin/manage";
import { requireUser } from "@/lib/auth/session";
import { canAcceptBookings, inTrial, planName } from "@/lib/billing/access";
import { config } from "@/lib/config";
import {
  removeMemberAction,
  restoreAccount,
  revokeInviteAction,
  saveBilling,
  saveBonusSeats,
  savePaidSeats,
  suspendAccount,
} from "../actions";

export const metadata = { title: "Account · Admin · Slotnest" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function AdminAccount({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const admin = await requireUser();
  if (!isAdmin(admin)) notFound();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const q = await searchParams;
  const data = await getAccount(admin, id).catch(() => null);
  if (!data) notFound();
  const { account: a, team, members, invites, limit, stripe } = data;
  const tz = admin.timeZone;
  const day = (d: Date) => DateTime.fromJSDate(d).setZone(tz).toFormat("d LLL yyyy");
  const open = canAcceptBookings(a);
  const status = inTrial(a) ? "trial" : a.billingStatus === "active" && !stripe ? "comped" : a.billingStatus === "active" || a.billingStatus === "past_due" ? a.billingStatus : "free";
  const hidden = <input type="hidden" name="id" value={a.id} />;

  return (
    <>
      <p>
        <Link href="/dashboard/admin">← All accounts</Link>
      </p>
      {q.ok && <p className="notice">{q.ok}</p>}
      {q.error && (
        <p className="error" role="alert">
          {q.error}
        </p>
      )}

      <section className="panel">
        <h2>{a.name}</h2>
        <p className="muted">
          {a.email} · <a href={`${config.appUrl}/${a.username}`}>/{a.username}</a> · {a.timeZone.replaceAll("_", " ")} · joined {day(a.createdAt)}
        </p>
        <p>
          {a.suspendedAt ? (
            <strong className="danger-text">Suspended since {day(a.suspendedAt)}: booking pages are off.</strong>
          ) : open ? (
            `Booking pages are open (${planName(a)} plan).`
          ) : null}
        </p>
        {a.suspendedAt ? (
          <form action={restoreAccount}>
            {hidden}
            <button className="secondary" type="submit">
              Restore account
            </button>
          </form>
        ) : (
          <form action={suspendAccount}>
            {hidden}
            <button className="secondary danger-text" type="submit">
              Suspend account
            </button>
            <p className="muted small">Turns off their booking pages and their team&apos;s. Existing meetings stay; they can still sign in.</p>
          </form>
        )}
      </section>

      <section className="panel">
        <h2>Seats</h2>
        <p className="muted">
          {limit === null
            ? "No seat limit right now (trial, or billing isn't enforced on this server)."
            : `${limit} ${limit === 1 ? "seat" : "seats"} in all: ${a.plan === "team" ? a.seats : 1} from the plan + ${a.bonusSeats} free.`}{" "}
          {team ? `Their team uses ${members.length} (plus ${invites.length} open ${invites.length === 1 ? "invite" : "invites"}).` : "They don't own a team."}
        </p>
        {stripe && a.plan === "team" && (
          <form action={savePaidSeats} className="row wrap">
            {hidden}
            <span>Paid seats</span>
            <input name="seats" type="number" min={2} max={MAX_SEATS} defaultValue={a.seats} required />
            <button className="secondary" type="submit">
              Change in Stripe
            </button>
            <p className="muted small">More seats are charged now (setup fee plus prorated yearly fee); fewer give a prorated credit on the next invoice.</p>
          </form>
        )}
        <form action={saveBonusSeats} className="row wrap">
          {hidden}
          <span>Free seats</span>
          <input name="bonusSeats" type="number" min={0} max={MAX_SEATS} defaultValue={a.bonusSeats} required />
          <button className="secondary" type="submit">
            Save
          </button>
          <p className="muted small">Extra seats at no charge, on top of the plan. Stripe never changes these.</p>
        </form>
      </section>

      <section className="panel">
        <h2>Plan and billing</h2>
        <p className="muted">
          {a.plan === "team" ? "Team" : "Solo"} ·{" "}
          {status === "trial" ? `trial until ${day(a.trialEndsAt)}` : status === "comped" ? "paid outside Stripe" : status === "free" ? "Free plan" : status.replace("_", " ")}
          {stripe && " · pays through Stripe"}
          {a.maintenancePaidUntil && ` · paid until ${day(a.maintenancePaidUntil)}`}
        </p>
        {stripe ? (
          <p className="muted small">Their plan and status follow their Stripe subscription. Change them in Stripe, or cancel it there first.</p>
        ) : (
          <form action={saveBilling} className="admin-billing">
            {hidden}
            <label>
              Plan
              <select name="plan" defaultValue={a.plan}>
                <option value="solo">Solo</option>
                <option value="team">Team</option>
              </select>
            </label>
            <fieldset>
              <label className="row">
                <input type="radio" name="status" value="trial" defaultChecked={status === "trial"} /> Trial until
                <input name="trialEndsAt" type="date" defaultValue={DateTime.fromJSDate(a.trialEndsAt).setZone(tz).toISODate()!} />
              </label>
              <label className="row">
                <input type="radio" name="status" value="comped" defaultChecked={status === "comped"} /> Paid outside Stripe (comped): every feature, no end date
              </label>
              <label className="row">
                <input type="radio" name="status" value="free" defaultChecked={status === "free" || status === "past_due"} /> Free plan: one event type
              </label>
            </fieldset>
            <button className="primary fit" type="submit">
              Save plan and status
            </button>
          </form>
        )}
      </section>

      {team && (
        <section className="panel">
          <h2>Team: {team.name}</h2>
          <p className="muted">
            <a href={`${config.appUrl}/${team.slug}`}>/{team.slug}</a>
          </p>
          <table className="list">
            <tbody>
              {members.map((m) => (
                <tr key={m.user.id}>
                  <td>
                    <strong>{m.user.name}</strong> <span className="muted">&lt;{m.user.email}&gt;</span>
                    <div className="muted small">
                      {m.role === "owner" ? "Owner" : "Member"} since {day(m.joinedAt)}
                    </div>
                  </td>
                  <td className="right">
                    {m.role !== "owner" && (
                      <form action={removeMemberAction}>
                        {hidden}
                        <input type="hidden" name="memberId" value={m.user.id} />
                        <button className="link inline danger-text small" type="submit">
                          Remove
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>
                    {i.email}
                    <div className="muted small">Invited, open until {day(i.expiresAt)}</div>
                  </td>
                  <td className="right">
                    <form action={revokeInviteAction}>
                      {hidden}
                      <input type="hidden" name="inviteId" value={i.id} />
                      <button className="link inline danger-text small" type="submit">
                        Revoke
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
