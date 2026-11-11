import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { getCurrentUser, requestLoginLink } from "@/lib/auth/session";

export const metadata = { title: "Sign in · Slotnest" };

async function sendLink(form: FormData) {
  "use server";
  const email = String(form.get("email") ?? "").trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320) await requestLoginLink(email);
  redirect("/login?sent=1");
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { sent, error } = await searchParams;
  return (
    <main className="auth">
      <Logo />
      <section className="card confirm">
        <h1>Sign in</h1>
        {sent ? (
          <p>Check your inbox. If the address is valid, we sent a sign-in link that works for 15 minutes.</p>
        ) : (
          <form action={sendLink} className="details center">
            {error && <p className="error">That link has expired or was already used. Request a new one.</p>}
            <label>
              Work email
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <button className="primary" type="submit">
              Email me a sign-in link
            </button>
            <p className="muted small">New here? The same link creates your account.</p>
          </form>
        )}
      </section>
    </main>
  );
}
