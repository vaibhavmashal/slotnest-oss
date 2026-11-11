"use client";

import { useEffect, useState } from "react";
import type { BookingQuestion } from "@/db/schema";

const MAX = 10;
const TYPES = [
  ["text", "Short answer"],
  ["textarea", "Paragraph"],
  ["phone", "Phone number"],
  ["select", "Dropdown"],
] as const;

type Draft = Omit<BookingQuestion, "options"> & { options: string };

const toDraft = (q: BookingQuestion): Draft => ({ ...q, options: (q.options ?? []).join("\n") });

/** A short id for a new question, so routing rules can refer to it before it's saved (see parseQuestions). */
const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");

const toQuestions = (rows: Draft[]): BookingQuestion[] =>
  rows.map(({ options, ...q }) => ({
    ...q,
    ...(q.type === "select" && { options: options.split("\n").map((o) => o.trim()).filter(Boolean) }),
  }));

/**
 * Edits custom questions (an event type's booking questions, or a routing form's); submits them as JSON in the
 * hidden "questions" field. `onChange` sees every edit, for editors that depend on the questions.
 */
export default function QuestionsEditor({
  initial,
  legend = "Booking questions",
  intro,
  onChange,
}: {
  initial: BookingQuestion[];
  legend?: string;
  intro?: React.ReactNode;
  onChange?: (questions: BookingQuestion[]) => void;
}) {
  const [rows, setRows] = useState<Draft[]>(initial.map(toDraft));
  useEffect(() => {
    onChange?.(toQuestions(rows));
  }, [rows, onChange]);
  const set = (i: number, patch: Partial<Draft>) => setRows((r) => r.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, by: number) =>
    setRows((r) => {
      const next = [...r];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  const json = JSON.stringify(toQuestions(rows));

  return (
    <fieldset className="stack">
      <legend>{legend}</legend>
      <p className="muted small">
        {intro ?? (
          <>
            Everyone is asked for their name and email, and can add a note. Add up to {MAX} more questions, such as company, phone
            number or what they&apos;d like to discuss. Answers appear in your email, calendar event and dashboard.
          </>
        )}
      </p>
      <input type="hidden" name="questions" value={json} />
      {rows.map((q, i) => (
        <div className="question" key={q.id}>
          <div className="question-main">
            <label>
              Question {i + 1}
              <input value={q.label} maxLength={200} placeholder="e.g. Company name" onChange={(e) => set(i, { label: e.target.value })} />
            </label>
            <label>
              Answer type
              <select value={q.type} onChange={(e) => set(i, { type: e.target.value as Draft["type"] })}>
                {TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {q.type === "select" && (
            <label>
              Options (one per line)
              <textarea rows={3} value={q.options} onChange={(e) => set(i, { options: e.target.value })} />
            </label>
          )}
          <div className="row wrap tight">
            <label className="day">
              <input type="checkbox" checked={q.required} onChange={(e) => set(i, { required: e.target.checked })} /> Required
            </label>
            <span className="question-tools">
              <button type="button" className="secondary small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                ↑
              </button>
              <button type="button" className="secondary small" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                ↓
              </button>
              <button type="button" className="link inline danger-text small" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
                Remove
              </button>
            </span>
          </div>
        </div>
      ))}
      {rows.length < MAX && (
        <button
          type="button"
          className="secondary small fit"
          onClick={() => setRows((r) => [...r, { id: newId(), label: "", type: "text", required: false, options: "" }])}
        >
          + Add a question
        </button>
      )}
    </fieldset>
  );
}
