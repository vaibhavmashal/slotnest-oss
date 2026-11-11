import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { routingForms, routingSubmissions } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { DateTime } from "luxon";
import { formUrl, routableEventTypes } from "@/lib/routing";
import { deleteRoutingForm, saveRoutingForm } from "../actions";
import RoutingFormEditor from "./RoutingFormEditor";

export const metadata = { title: "Routing form · Slotnest" };

const ERRORS: Record<string, string> = {
  title: "Give the form a name.",
  slug: "The link can use lowercase letters, numbers and dashes.",
  "slug-taken": "You already have a form with that link.",
  questions: "Check the questions: dropdowns need at least one option.",
  rules: "Each rule needs a question, a value and a destination (an event type, an https:// address or a message).",
  fallback: "Choose where everyone else goes.",
  plan: "Routing forms are part of the paid plans. Upgrade on the Billing page to edit and use them.",
};

type Search = Promise<{ saved?: string; created?: string; error?: string }>;

export default async function EditRoutingForm({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Search }) {
  const user = await requireUser();
  const { id } = await params;
  const q = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [form] = await db.select().from(routingForms).where(and(eq(routingForms.id, id), eq(routingForms.userId, user.id)));
  if (!form) notFound();
  const events = await routableEventTypes(user);
  const responses = await db
    .select()
    .from(routingSubmissions)
    .where(eq(routingSubmissions.formId, form.id))
    .orderBy(desc(routingSubmissions.createdAt))
    .limit(50);
  const url = formUrl(user.username, form.slug);

  return (
    <>
      <p className="small">
        <Link href="/dashboard/routing">← Routing forms</Link>
      </p>
      {q.created && <p className="notice">Form created. Add your questions and rules, then save.</p>}
      {q.saved && <p className="notice">Saved.</p>}
      {q.error && <p className="error">{ERRORS[q.error] ?? "Couldn't save the form."}</p>}

      <section className="panel">
        <h2>{form.title}</h2>
        <p className="muted small">
          Share this link, or use it as the button on your website: <a href={url}>{url}</a>
        </p>
        <form action={saveRoutingForm} className="stack">
          <input type="hidden" name="id" value={form.id} />
          <label>
            Name
            <input name="title" required maxLength={120} defaultValue={form.title} />
          </label>
          <label>
            Link
            <span className="row">
              <span className="muted small nowrap">/f/{user.username}/</span>
              <input name="slug" required maxLength={64} pattern="[a-z0-9][a-z0-9\-]*" defaultValue={form.slug} />
            </span>
          </label>
          <label>
            Intro <span className="muted">(optional)</span>
            <textarea name="description" rows={2} maxLength={2000} defaultValue={form.description ?? ""} />
          </label>
          <RoutingFormEditor
            questions={form.questions}
            rules={form.routes}
            fallback={form.fallback}
            events={events.map((e) => ({ id: e.id, title: e.isActive ? e.title : `${e.title} (off)` }))}
          />
          <label className="day">
            <input type="checkbox" name="isActive" defaultChecked={form.isActive} /> Form is on (people can fill it in)
          </label>
          <button className="primary fit" type="submit">
            Save
          </button>
        </form>
      </section>

      <section className="panel">
        <h2>Responses</h2>
        {responses.length === 0 ? (
          <p className="muted">No one has filled in this form yet.</p>
        ) : (
          <table className="list">
            <tbody>
              {responses.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.inviteeName}</strong> &lt;{r.inviteeEmail}&gt;
                    <div className="muted small">
                      {DateTime.fromJSDate(r.createdAt).setZone(user.timeZone).toFormat("d LLL yyyy, HH:mm")} · Sent to: {r.routedTo}
                    </div>
                    {r.answers.length > 0 && (
                      <div className="muted small">
                        {r.answers.map((a) => (
                          <div key={a.id}>
                            {a.label}: {a.value}
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel">
        <h2>Delete this form</h2>
        <p className="muted small">The link stops working and its responses are deleted.</p>
        <form action={deleteRoutingForm}>
          <input type="hidden" name="id" value={form.id} />
          <button className="secondary danger-text" type="submit">
            Delete form
          </button>
        </form>
      </section>
    </>
  );
}
