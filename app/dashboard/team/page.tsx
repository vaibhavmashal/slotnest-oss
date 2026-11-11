import Link from "next/link";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { bookingHosts, bookings, eventTypes, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { seatLimit, teamPlanAllows } from "@/lib/billing/access";
import { config } from "@/lib/config";
import { formatWhen } from "@/lib/email/templates";
import { joinNames, openInvites, ownedTeam, teamMemberList, teamsForUser } from "@/lib/teams";
import { createTeamAction, inviteAction, leaveTeamAction, removeMemberAction, revokeInviteAction } from "./actions";

const ERRORS: Record<string, string> = {
  TAKEN: "That link is taken. Team links and usernames share one namespace.",
  OWNS_TEAM: "You already own a team.",
  NAME: "Please enter a team name.",
  SLUG: "Team links are 2–39 characters: lowercase letters, numbers and hyphens, starting with a letter or number (for example at20-sales).",
  EMAIL: "Please enter a valid email address.",
  MEMBER: "That person is already on the team.",
  FORBIDDEN: "Only the team owner can do that, and the owner can't leave the team.",
  SEATS: "All seats are in use. Add seats on the Billing page, or revoke an open invite.",
  PLAN: "Teams are part of the Team plan. Upgrade on the Billing page.",
  NOT_FOUND: "That invite has expired or was already used.",
};

const DONE: Record<string, string> = {
  created: "Team created. Invite your colleagues, then create a team event type.",
  invited: "Invite sent.",
  revoked: "Invite revoked.",
  removed: "Member removed. Their existing bookings stay with them.",
  left: "You left the team.",
  joined: "You joined the team. Set your hours on the Availability page; team bookings assigned to you appear on your Overview.",
};

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ error?: string; done?: string; name?: string; slug?: string }> }) {
  const user = await requireUser();
  const q = await searchParams;
  const team = await ownedTeam(user.id);
  const memberships = (await teamsForUser(user.id)).filter((m) => m.role !== "owner");
  const d = (x: Date) => x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  const notices = (
    <>
      {q.error && <p className="error">{ERRORS[q.error] ?? "Something went wrong."}</p>}
      {q.done && <p className="notice">{DONE[q.done] ?? "Done."}</p>}
    </>
  );

  const memberOf = memberships.length > 0 && (
    <section className="panel">
      <h2>Teams you're on</h2>
      <table className="list">
        <tbody>
          {memberships.map(({ team: t }) => (
            <tr key={t.id}>
              <td>
                <strong>{t.name}</strong>
                <div className="muted small">
                  {config.appUrl}/{t.slug}/…
                </div>
              </td>
              <td className="right">
                <form action={leaveTeamAction}>
                  <input type="hidden" name="teamId" value={t.id} />
                  <button className="link inline" type="submit">
                    Leave
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Team bookings assigned to you appear on your Overview with your other meetings.</p>
    </section>
  );

  if (!team) {
    return (
      <>
        {notices}
        {memberOf}
        <section className="panel">
          <h2>Create a team</h2>
          {teamPlanAllows(user) ? (
            <form action={createTeamAction} className="stack">
              <p className="muted small">
                A team has its own booking links. Round-robin event types share bookings evenly among the members you choose; collective
                event types book them all into one meeting.
              </p>
              <label>
                Team name (shown to invitees)
                <input name="name" required maxLength={100} defaultValue={q.name} />
              </label>
              <label>
                <span>Team link ({config.appUrl}/link/…)</span>
                <span className="muted small">Lowercase letters, numbers and hyphens. Spaces become hyphens.</span>
                <input name="slug" required defaultValue={q.slug} placeholder="at20-sales" />
              </label>
              <button className="primary fit" type="submit">
                Create team
              </button>
            </form>
          ) : (
            <p className="muted">
              Teams are part of the Team plan. <Link href="/dashboard/billing">Upgrade on the Billing page</Link>.
            </p>
          )}
        </section>
      </>
    );
  }

  const [members, invites, teamEvents, upcoming] = await Promise.all([
    teamMemberList(team.id),
    openInvites(team.id),
    db.select().from(eventTypes).where(eq(eventTypes.teamId, team.id)).orderBy(asc(eventTypes.createdAt)),
    db
      .select({
        booking: bookings,
        title: eventTypes.title,
        hostNames: sql<string[]>`array_agg(${users.name} ORDER BY ${users.name})`,
      })
      .from(bookings)
      .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
      .innerJoin(bookingHosts, eq(bookingHosts.bookingId, bookings.id))
      .innerJoin(users, eq(users.id, bookingHosts.hostId))
      .where(and(eq(eventTypes.teamId, team.id), eq(bookings.status, "confirmed"), gt(bookings.endAt, new Date())))
      .groupBy(bookings.id, eventTypes.title)
      .orderBy(asc(bookings.startAt))
      .limit(50),
  ]);
  const limit = seatLimit(user);

  return (
    <>
      {notices}
      <section className="panel">
        <h2>{team.name}</h2>
        <p className="muted small">
          Team links: {config.appUrl}/{team.slug}/… · {members.length} member{members.length === 1 ? "" : "s"}
          {limit !== null && ` of ${limit} seats`}
          {invites.length > 0 && ` · ${invites.length} invite${invites.length === 1 ? "" : "s"} pending`}
        </p>
        <table className="list">
          <tbody>
            {members.map((m) => (
              <tr key={m.user.id}>
                <td>
                  <strong>{m.user.name}</strong> {m.role === "owner" && <span className="muted">(owner)</span>}
                  <div className="muted small">{m.user.email}</div>
                </td>
                <td className="right">
                  {m.role !== "owner" && (
                    <form action={removeMemberAction}>
                      <input type="hidden" name="userId" value={m.user.id} />
                      <button className="link inline" type="submit">
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
                  {i.email} <span className="muted">(invited, link expires {d(i.expiresAt)})</span>
                </td>
                <td className="right">
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <button className="link inline" type="submit">
                      Revoke
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={inviteAction} className="row wrap">
          <input name="email" type="email" required placeholder="colleague@company.com" aria-label="Email address to invite" />
          <button className="secondary" type="submit">
            Send invite
          </button>
        </form>
        <p className="muted small">
          Members sign in with their own email, set their own hours and connect their own calendar. Each member is one seat.
        </p>
      </section>

      <section className="panel">
        <div className="row spread">
          <h2>Team event types</h2>
          <Link className="secondary fit" href="/dashboard/event-types/new?team=1">
            New team event type
          </Link>
        </div>
        {teamEvents.length === 0 ? (
          <p className="muted">No team event types yet.</p>
        ) : (
          <table className="list">
            <tbody>
              {teamEvents.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.title}</strong> {!e.isActive && <span className="muted">(off)</span>}
                    <div className="muted small">
                      {e.scheduling === "collective" ? "Collective" : "Round-robin"} · {e.durationMinutes} min ·{" "}
                      <a href={`${config.appUrl}/${team.slug}/${e.slug}`}>
                        {config.appUrl}/{team.slug}/{e.slug}
                      </a>
                    </div>
                  </td>
                  <td className="right">
                    <Link href={`/dashboard/event-types/${e.id}`}>Edit</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Upcoming team meetings</h2>
        {upcoming.length === 0 ? (
          <p className="muted">No upcoming team meetings.</p>
        ) : (
          <table className="list">
            <tbody>
              {upcoming.map(({ booking: b, title, hostNames }) => (
                <tr key={b.id}>
                  <td>
                    <strong>{formatWhen(b.startAt, b.endAt, user.timeZone)}</strong>
                    <div className="muted small">
                      {title} · {b.inviteeName} &lt;{b.inviteeEmail}&gt; · with {joinNames(hostNames)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      {memberOf}
    </>
  );
}
