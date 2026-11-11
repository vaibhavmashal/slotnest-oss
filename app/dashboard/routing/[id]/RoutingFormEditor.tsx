"use client";

import { useCallback, useState } from "react";
import type { BookingQuestion, RouteTarget, RoutingRule } from "@/db/schema";
import QuestionsEditor from "../../event-types/QuestionsEditor";

const MAX_RULES = 20;
const OPS = [
  ["is", "is"],
  ["is_not", "is not"],
  ["contains", "contains"],
] as const;

type Event = { id: string; title: string };

/** Questions, rules and the fallback, posted as JSON in the hidden "questions", "rules" and "fallback" fields. */
export default function RoutingFormEditor(p: { questions: BookingQuestion[]; rules: RoutingRule[]; fallback: RouteTarget; events: Event[] }) {
  const [questions, setQuestions] = useState(p.questions);
  const [rules, setRules] = useState(p.rules);
  const [fallback, setFallback] = useState(p.fallback);
  const onQuestions = useCallback((q: BookingQuestion[]) => setQuestions(q), []);
  const named = questions.filter((q) => q.label.trim());
  const set = (i: number, patch: Partial<RoutingRule>) => setRules((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, by: number) =>
    setRules((r) => {
      const next = [...r];
      [next[i], next[i + by]] = [next[i + by], next[i]];
      return next;
    });
  const defaultTarget = (): RouteTarget => (p.events[0] ? { type: "event", eventTypeId: p.events[0].id } : { type: "message", text: "" });

  return (
    <>
      <QuestionsEditor
        initial={p.questions}
        legend="Questions"
        intro="Everyone gives their name and email. Add the questions you route on, such as company size, topic or region. Dropdowns are easiest to route on."
        onChange={onQuestions}
      />
      <fieldset className="stack">
        <legend>Rules</legend>
        <p className="muted small">Checked from the top; the first rule that matches decides where they go.</p>
        <input type="hidden" name="rules" value={JSON.stringify(rules)} />
        {named.length === 0 && <p className="muted small">Add a question above to create rules.</p>}
        {rules.map((r, i) => {
          const q = named.find((x) => x.id === r.questionId);
          return (
            <div className="question" key={r.id}>
              <div className="rule-line">
                <span className="small">If</span>
                <select value={r.questionId} onChange={(e) => set(i, { questionId: e.target.value, value: "" })} aria-label="Question">
                  {!q && <option value={r.questionId}>(removed question)</option>}
                  {named.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.label}
                    </option>
                  ))}
                </select>
                <select value={r.op} onChange={(e) => set(i, { op: e.target.value as RoutingRule["op"] })} aria-label="Condition">
                  {OPS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                {q?.type === "select" && r.op !== "contains" ? (
                  <select value={r.value} onChange={(e) => set(i, { value: e.target.value })} aria-label="Answer">
                    <option value="">Choose…</option>
                    {q.options?.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input value={r.value} maxLength={200} placeholder="answer" onChange={(e) => set(i, { value: e.target.value })} aria-label="Answer" />
                )}
              </div>
              <TargetPicker label="then" target={r.target} events={p.events} onChange={(target) => set(i, { target })} />
              <div className="row tight">
                <span className="question-tools">
                  <button type="button" className="secondary small" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" className="secondary small" disabled={i === rules.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                    ↓
                  </button>
                  <button type="button" className="link inline danger-text small" onClick={() => setRules((x) => x.filter((_, j) => j !== i))}>
                    Remove
                  </button>
                </span>
              </div>
            </div>
          );
        })}
        {named.length > 0 && rules.length < MAX_RULES && (
          <button
            type="button"
            className="secondary small fit"
            onClick={() =>
              setRules((x) => [...x, { id: Math.random().toString(36).slice(2, 10), questionId: named[0].id, op: "is", value: "", target: defaultTarget() }])
            }
          >
            + Add a rule
          </button>
        )}
      </fieldset>
      <fieldset className="stack">
        <legend>Everyone else</legend>
        <input type="hidden" name="fallback" value={JSON.stringify(fallback)} />
        <TargetPicker label="Send them to" target={fallback} events={p.events} onChange={setFallback} />
      </fieldset>
    </>
  );
}

function TargetPicker({ label, target, events, onChange }: { label: string; target: RouteTarget; events: Event[]; onChange: (t: RouteTarget) => void }) {
  const switchTo = (type: RouteTarget["type"]) =>
    onChange(
      type === "event" ? { type, eventTypeId: events[0]?.id ?? "" } : type === "url" ? { type, url: "" } : { type, text: "" },
    );
  return (
    <div className="stack tight-stack">
      <div className="rule-line">
        <span className="small">{label}</span>
        <select value={target.type} onChange={(e) => switchTo(e.target.value as RouteTarget["type"])} aria-label="Destination">
          {events.length > 0 && <option value="event">book an event type</option>}
          <option value="url">go to a web page</option>
          <option value="message">see a message</option>
        </select>
        {target.type === "event" && (
          <select value={target.eventTypeId} onChange={(e) => onChange({ type: "event", eventTypeId: e.target.value })} aria-label="Event type">
            {!events.some((e) => e.id === target.eventTypeId) && <option value={target.eventTypeId}>(deleted event type)</option>}
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        )}
        {target.type === "url" && (
          <input type="url" value={target.url} maxLength={2000} placeholder="https://…" onChange={(e) => onChange({ type: "url", url: e.target.value })} aria-label="Web address" />
        )}
      </div>
      {target.type === "message" && (
        <textarea
          rows={2}
          maxLength={1000}
          value={target.text}
          placeholder="e.g. Thanks! We only work with companies of 10+ people, but here's our self-serve guide: …"
          onChange={(e) => onChange({ type: "message", text: e.target.value })}
          aria-label="Message"
        />
      )}
    </div>
  );
}
