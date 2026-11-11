import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { availabilityRules, eventTypes, schedules, users } from "@/db/schema";
import { consumeLoginToken, peekLoginToken, safeNext, startSession } from "@/lib/auth/session";
import { handleTaken } from "@/lib/teams";
import TimeZoneSelect from "@/components/TimeZoneSelect";
import { cleanZone } from "@/lib/timezones";

export const metadata = { title: "Set up your account · Slotnest" };

async function createAccount(form: FormData) {
  "use server";
  const token = String(form.get("token") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, 100);
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const zone = cleanZone(String(form.get("timeZone") ?? "UTC"));
  const next = safeNext(form.get("next"));
  // Back to the form with what they typed, so a mistake doesn't mean starting over.
  const back = (e: string): never => {
    const q = new URLSearchParams({ token, error: e, name, username: username.slice(0, 39) });
    if (zone) q.set("tz", zone);
    if (next) q.set("next", next);
    return redirect(`/onboarding?${q}`);
  };

  if (!name) back("name");
  if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(username)) back("username");
  const timeZone = zone ?? back("tz");
  // Usernames share a namespace with team links; the handles table enforces it, this gives a friendly error first.
  if (await handleTaken(username)) back("taken");

  const email = await consumeLoginToken(token);
  if (!email) redirect("/login?error=expired");

  const userId = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email: email!, name, username, timeZone, billingStatus: "free", trialEndsAt: new Date() }).returning();
    const [s] = await tx.insert(schedules).values({ userId: u.id, name: "Working hours", timeZone, isDefault: true }).returning();
    await tx.insert(availabilityRules).values([1, 2, 3, 4, 5].map((weekday) => ({ scheduleId: s.id, weekday, startMinute: 540, endMinute: 1020 })));
    await tx.insert(eventTypes).values({ userId: u.id, scheduleId: s.id, slug: "30min", title: "30 minute meeting", durationMinutes: 30 });
    return u.id;
  });
  await startSession(userId);
  redirect(next ?? "/dashboard?welcome=1");
}

const ERRORS: Record<string, string> = {
  name: "Please enter your name.",
  username: "Usernames are 2–39 characters: lowercase letters, numbers and hyphens.",
  taken: "That username is taken.",
  tz: "Please choose a time zone.",
};

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ token?: string; error?: string; next?: string; name?: string; username?: string; tz?: string }> }) {
  const { token, error, next, name, username, tz } = await searchParams;
  const email = token ? await peekLoginToken(token) : null;
  if (!email) redirect("/login?error=expired");
  return (
    <main className="auth">
      <section className="card confirm">
        <h1>Set up your booking page</h1>
        <p className="muted">{email}</p>
        <form action={createAccount} className="details center">
          <input type="hidden" name="token" value={token} />
          {safeNext(next) && <input type="hidden" name="next" value={safeNext(next)!} />}
          {error && <p className="error">{ERRORS[error] ?? "Please check the form."}</p>}
          <label>
            Your name (shown to invitees)
            <input name="name" required maxLength={100} defaultValue={name} />
          </label>
          <label>
            Username (your link: /username/…)
            <input name="username" required pattern="[a-z0-9][a-z0-9\-]{1,38}" defaultValue={username} />
          </label>
          <label>
            Your time zone
            <TimeZoneSelect name="timeZone" defaultValue={tz ? (cleanZone(tz) ?? undefined) : undefined} />
          </label>
          <button className="primary" type="submit">
            Create free account
          </button>
        </form>
      </section>
    </main>
  );
}
