import { requireUser } from "@/lib/auth/session";
import { formatWhen } from "@/lib/email/templates";
import { listWebhooks, MAX_WEBHOOKS, WEBHOOK_EVENTS, webhookSecret } from "@/lib/webhooks";
import { hasPaidFeatures } from "@/lib/teams";
import { UpgradeNotice } from "../UpgradeNotice";
import { addWebhook, removeWebhook, testWebhook } from "./actions";

export const metadata = { title: "Webhooks · Slotnest" };

const EVENT_LABEL: Record<string, string> = {
  "booking.created": "Booking created",
  "booking.rescheduled": "Booking rescheduled",
  "booking.cancelled": "Booking cancelled",
};

type Search = Promise<{ added?: string; removed?: string; tested?: string; status?: string; error?: string; url?: string }>;

export default async function Webhooks({ searchParams }: { searchParams: Search }) {
  const user = await requireUser();
  const q = await searchParams;
  const hooks = await listWebhooks(user.id);
  const paid = await hasPaidFeatures(user);
  return (
    <>
      {!paid && <UpgradeNotice feature="Webhooks" />}
      {q.added && <p className="notice">Webhook added. Copy its signing secret below to verify deliveries.</p>}
      {q.removed && <p className="notice">Webhook removed.</p>}
      {q.tested && !q.error && <p className="notice">Test sent: your endpoint answered HTTP {q.status}.</p>}
      {q.error && <p className="error">{q.tested ? `Test failed: ${q.error}` : q.error}</p>}

      <section className="panel">
        <h2>Webhooks</h2>
        <p className="muted">
          Send bookings to your CRM, Slack, Zapier, Make or your own app. Slotnest POSTs a JSON message to your address whenever
          one of your bookings (including team bookings you host) is created, rescheduled or cancelled. If your endpoint is down, we
          retry five more times over about 15 minutes.
        </p>
        {hooks.length === 0 ? (
          <p className="muted">No webhooks yet.</p>
        ) : (
          <table className="list">
            <tbody>
              {hooks.map((w) => (
                <tr key={w.id}>
                  <td>
                    <strong className="break">{w.url}</strong>
                    <div className="muted small">{w.events.map((e) => EVENT_LABEL[e] ?? e).join(" · ")}</div>
                    <div className="small">
                      {w.lastDeliveredAt ? (
                        w.lastError ? (
                          <span className="error">
                            Last delivery failed ({formatWhen(w.lastDeliveredAt, w.lastDeliveredAt, user.timeZone)}): {w.lastError}
                          </span>
                        ) : (
                          <span className="ok">Last delivery OK, HTTP {w.lastStatus}</span>
                        )
                      ) : (
                        <span className="muted">Nothing sent yet</span>
                      )}
                    </div>
                    <details className="small" open={q.added === w.id}>
                      <summary>Signing secret</summary>
                      <pre>{webhookSecret(w)}</pre>
                    </details>
                  </td>
                  <td className="right nowrap">
                    <form action={testWebhook} className="inline">
                      <input type="hidden" name="id" value={w.id} />
                      <button className="secondary small" type="submit">
                        Send test
                      </button>
                    </form>{" "}
                    <form action={removeWebhook} className="inline">
                      <input type="hidden" name="id" value={w.id} />
                      <button className="link inline danger-text small" type="submit">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {hooks.length < MAX_WEBHOOKS && (
        <section className="panel">
          <h2>Add a webhook</h2>
          <form action={addWebhook} className="stack">
            <label>
              Endpoint address
              <input name="url" type="url" required placeholder="https://hooks.zapier.com/…" defaultValue={q.url} maxLength={2000} />
            </label>
            <fieldset className="stack">
              <legend>Send me</legend>
              {WEBHOOK_EVENTS.map((e) => (
                <label className="day" key={e}>
                  <input type="checkbox" name="events" value={e} defaultChecked /> {EVENT_LABEL[e]}
                </label>
              ))}
            </fieldset>
            <button className="primary fit" type="submit">
              Add webhook
            </button>
          </form>
        </section>
      )}

      <section className="panel">
        <h2>What we send</h2>
        <p className="muted small">
          Each message is JSON with <code>event</code>, a unique <code>id</code> (the same on retries, so you can skip
          duplicates), <code>created_at</code> and <code>data</code>: the booking id, start and end times, event type, invitee
          name, email and time zone, hosts, answers to your booking questions, notes, meeting link and a reschedule/cancel link.
        </p>
        <p className="muted small">
          To check a message came from Slotnest, read the <code>Slotnest-Signature</code> header, <code>t=…,v1=…</code>. Compute
          HMAC-SHA256 of <code>{"{t}.{raw body}"}</code> with your signing secret and compare it with <code>v1</code>. Reject messages
          whose <code>t</code> is more than 5 minutes old.
        </p>
      </section>
    </>
  );
}
