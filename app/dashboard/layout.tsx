import { Logo } from "@/components/Logo";
import { isAdmin } from "@/lib/admin";
import { assistantAvailable } from "@/lib/assistant";
import { requireUser } from "@/lib/auth/session";
import { signOut } from "./actions";
import { DashNav } from "./DashNav";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="dash">
      <header className="dash-top">
        <Logo href="/dashboard" />
        <DashNav assistant={assistantAvailable()} admin={isAdmin(user)} />
        <form action={signOut}>
          <span className="muted small">{user.email}</span>{" "}
          <button className="link inline" type="submit">
            Sign out
          </button>
        </form>
      </header>
      <main className="dash-main">{children}</main>
    </div>
  );
}
