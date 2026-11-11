import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { formsWithCounts, formUrl } from "@/lib/routing";
import { hasPaidFeatures } from "@/lib/teams";
import { UpgradeNotice } from "../UpgradeNotice";
import { createRoutingForm } from "./actions";

export const metadata = { title: "Routing forms · Slotnest" };

export default async function RoutingForms({ searchParams }: { searchParams: Promise<{ deleted?: string; error?: string }> }) {
  const user = await requireUser();
  const q = await searchParams;
  const forms = await formsWithCounts(user.id);
  return (
    <>
      {q.deleted && <p className="notice">Routing form deleted.</p>}
      {q.error === "title" && <p className="error">Give the form a name.</p>}
      {!(await hasPaidFeatures(user)) && <UpgradeNotice feature="Routing forms" />}
      <section className="panel">
        <h2>Routing forms</h2>
        <p className="muted">
          Ask a few questions first, then send each person to the right place: a sales call for big companies, a support slot
          for customers, a team member who speaks their language, or a page or message when a meeting isn&apos;t the right
          next step. Their name, email and matching answers are filled in on the booking page.
        </p>
        {forms.length === 0 ? (
          <p className="muted">No routing forms yet.</p>
        ) : (
          <table className="list">
            <tbody>
              {forms.map(({ form: f, submissions }) => {
                const url = formUrl(user.username, f.slug);
                return (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.title}</strong> {!f.isActive && <span className="muted">(off)</span>}
                      <div className="muted small">
                        {f.questions.length} {f.questions.length === 1 ? "question" : "questions"} · {f.routes.length}{" "}
                        {f.routes.length === 1 ? "rule" : "rules"} · {submissions} {submissions === 1 ? "response" : "responses"} ·{" "}
                        <a href={url}>{url}</a>
                      </div>
                    </td>
                    <td className="right">
                      <Link href={`/dashboard/routing/${f.id}`}>Edit</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <h2>New routing form</h2>
        <form action={createRoutingForm} className="row">
          <input name="title" required maxLength={120} placeholder="e.g. Talk to us" aria-label="Form name" />
          <button className="primary fit" type="submit">
            Create
          </button>
        </form>
      </section>
    </>
  );
}
