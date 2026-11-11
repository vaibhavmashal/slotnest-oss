import { redirect } from "next/navigation";
import { endSession, getCurrentUser, requestLoginLink, safeNext } from "@/lib/auth/session";
import { acceptInvite, getInvite, TeamError } from "@/lib/teams";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team invite · Slotnest", robots: { index: false } };

type Params = Promise<{ token: string }>;

async function accept(form: FormData) {
  "use server";
  const token = String(form.get("token") ?? "");
  const user = await getCurrentUser();
  if (!user) redirect(`/invite/${token}`);
  try {
    await acceptInvite(token, user!);
  } catch (err) {
    if (err instanceof TeamError) redirect(`/invite/${token}?error=${err.code}`);
    throw err;
  }
  redirect("/dashboard/team?done=joined");
}

/** Sign-in for the invited address only; the link brings them back here (through onboarding if they're new). */
async function sendLink(form: FormData) {
  "use server";
  const token = String(form.get("token") ?? "");
  const row = await getInvite(token);
  const next = safeNext(`/invite/${token}`);
  if (row && next) await requestLoginLink(row.invite.email, next);
  redirect(`/invite/${token}?sent=1`);
}

async function switchAccount(form: FormData) {
  "use server";
  await endSession();
  redirect(`/invite/${String(form.get("token") ?? "")}`);
}

const ERRORS: Record<string, string> = {
  SEATS: "The team has no free seats. Ask the owner to add one.",
  FORBIDDEN: "This invite is for a different email address.",
  NOT_FOUND: "This invite has expired or was already used.",
};

export default async function InvitePage({ params, searchParams }: { params: Params; searchParams: Promise<{ sent?: string; error?: string }> }) {
  const { token } = await params;
  const { sent, error } = await searchParams;
  const row = await getInvite(token);
  const user = await getCurrentUser();

  let body: React.ReactNode;
  if (!row) {
    body = (
      <>
        <h1>Invite not valid</h1>
        <p className="muted">This invite has expired or was already used. Ask the team owner to send a new one.</p>
      </>
    );
  } else {
    const { invite, team } = row;
    body = (
      <>
        <h1>Join {team.name}</h1>
        <p className="muted">Invite for {invite.email}</p>
        {error && <p className="error">{ERRORS[error] ?? "Something went wrong."}</p>}
        {sent ? (
          <p>Check your inbox: we sent a sign-in link to {invite.email}. It brings you back here.</p>
        ) : !user ? (
          <form action={sendLink} className="details center">
            <input type="hidden" name="token" value={token} />
            <p>Sign in with {invite.email} to accept. New to Slotnest? The same link sets up your account.</p>
            <button className="primary" type="submit">
              Email me a sign-in link
            </button>
          </form>
        ) : user.email !== invite.email ? (
          <form action={switchAccount} className="details center">
            <input type="hidden" name="token" value={token} />
            <p>
              You're signed in as {user.email}. This invite is for {invite.email}.
            </p>
            <button className="secondary" type="submit">
              Sign out and continue
            </button>
          </form>
        ) : (
          <form action={accept} className="details center">
            <input type="hidden" name="token" value={token} />
            <p>You'll take bookings for {team.name} using your own hours and calendar.</p>
            <button className="primary" type="submit">
              Accept invite
            </button>
          </form>
        )}
      </>
    );
  }
  return (
    <main className="auth">
      <section className="card confirm">{body}</section>
    </main>
  );
}
