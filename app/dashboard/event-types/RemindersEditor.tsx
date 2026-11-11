"use client";

import { useState } from "react";
import type { Reminder } from "@/db/schema";

const MAX = 10;
const UNITS = [
  [1, "minutes"],
  [60, "hours"],
  [1440, "days"],
] as const;

type Draft = Omit<Reminder, "minutes" | "id"> & { id: string; amount: number; unit: number; subject: string; body: string };

const toDraft = (r: Reminder): Draft => {
  const unit = r.minutes % 1440 === 0 ? 1440 : r.minutes % 60 === 0 ? 60 : 1;
  return { ...r, amount: r.minutes / unit, unit, subject: r.subject ?? "", body: r.body ?? "" };
};

/** Edits the event type's reminder and follow-up emails; submits them as JSON in the hidden "reminders" field. */
export default function RemindersEditor({ initial }: { initial: Reminder[] }) {
  const [rows, setRows] = useState<Draft[]>(initial.map(toDraft));
  const set = (i: number, patch: Partial<Draft>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const json = JSON.stringify(
    rows.map((r) => ({
      ...(r.id && { id: r.id }),
      when: r.when,
      minutes: Math.round(r.amount * r.unit),
      to: r.to,
      ...(r.subject.trim() && { subject: r.subject }),
      ...(r.body.trim() && { body: r.body }),
    })),
  );

  return (
    <fieldset className="stack">
      <legend>Reminders and follow-ups</legend>
      <p className="muted small">
        Emails sent automatically around each booking: reminders before the meeting, thank-you or follow-up notes after it.
        Leave the wording blank to use Slotnest&apos;s. Changes apply to bookings made or rescheduled from now on.
      </p>
      <input type="hidden" name="reminders" value={json} />
      {rows.map((r, i) => (
        <div className="question" key={r.id || `new-${i}`}>
          <div className="reminder-when">
            <span>Send</span>
            <input
              type="number"
              min={1}
              max={r.unit === 1440 ? 30 : r.unit === 60 ? 720 : 43200}
              value={r.amount}
              onChange={(e) => set(i, { amount: Math.max(1, Number(e.target.value) || 1) })}
              aria-label="How long"
            />
            <select value={r.unit} onChange={(e) => set(i, { unit: Number(e.target.value) })} aria-label="Unit">
              {UNITS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select value={r.when} onChange={(e) => set(i, { when: e.target.value as Draft["when"] })} aria-label="Before or after">
              <option value="before">before it starts</option>
              <option value="after">after it ends</option>
            </select>
            <span>to</span>
            <select value={r.to} onChange={(e) => set(i, { to: e.target.value as Draft["to"] })} aria-label="Recipient">
              <option value="invitee">the invitee</option>
              <option value="host">me (the host)</option>
            </select>
          </div>
          <details open={!!(r.subject || r.body)}>
            <summary className="small">Custom wording</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              <label>
                Subject
                <input value={r.subject} maxLength={200} placeholder="e.g. See you soon, {{name}}!" onChange={(e) => set(i, { subject: e.target.value })} />
              </label>
              <label>
                Message
                <textarea
                  rows={4}
                  value={r.body}
                  maxLength={5000}
                  placeholder={"Hi {{name}},\nLooking forward to {{event}} on {{time}}.\nJoin here: {{location}}"}
                  onChange={(e) => set(i, { body: e.target.value })}
                />
              </label>
              <p className="muted small">
                You can use {"{{name}}"}, {"{{event}}"}, {"{{time}}"}, {"{{host}}"}, {"{{location}}"}, {"{{manage_link}}"} and{" "}
                {"{{booking_link}}"}.
              </p>
            </div>
          </details>
          <div className="row tight">
            <button type="button" className="link inline danger-text small" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        </div>
      ))}
      {rows.length < MAX && (
        <div className="row wrap tight">
          <button
            type="button"
            className="secondary small fit"
            onClick={() => setRows((x) => [...x, { id: "", when: "before", amount: 1, unit: 1440, to: "invitee", subject: "", body: "" }])}
          >
            + Add a reminder
          </button>
          <button
            type="button"
            className="secondary small fit"
            onClick={() => setRows((x) => [...x, { id: "", when: "after", amount: 1, unit: 60, to: "invitee", subject: "", body: "" }])}
          >
            + Add a follow-up
          </button>
        </div>
      )}
    </fieldset>
  );
}
