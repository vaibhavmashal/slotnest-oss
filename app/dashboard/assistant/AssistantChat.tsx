"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import type { ChatEntry } from "@/lib/assistant";

const SUGGESTIONS = [
  "What's on my calendar this week?",
  "When could someone book my first event type next week?",
  "Draft a friendly email asking my next invitee to reschedule",
  "Create a 15-minute quick chat event type",
];

export default function AssistantChat(p: { conversationId: string | null; initial: ChatEntry[]; firstName: string }) {
  const [conversationId, setConversationId] = useState(p.conversationId);
  const [entries, setEntries] = useState(p.initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [entries, busy]);

  async function post(url: string, body: unknown) {
    setError(null);
    setNotice(null);
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (!res?.ok) {
      setError(data?.error ?? "Couldn't reach the assistant. Check your connection and try again.");
      return null;
    }
    return data;
  }

  async function send(message: string) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setText("");
    setEntries((e) => [...e, { role: "user", text: message }]); // shown right away; replaced by the saved transcript
    const data = await post("/api/assistant/messages", { conversationId, text: message });
    setBusy(false);
    if (!data) {
      setEntries((e) => e.slice(0, -1));
      setText(message);
      return;
    }
    setConversationId(data.conversationId);
    setEntries(data.entries);
    if (data.notice) setNotice(data.notice);
  }

  async function decide(actionId: string, confirm: boolean) {
    setBusy(true);
    const data = await post("/api/assistant/actions", { conversationId, actionId, confirm });
    setBusy(false);
    if (data) setEntries(data.entries);
  }

  async function startOver() {
    const data = await post("/api/assistant/new", {});
    if (data) {
      setConversationId(data.conversationId);
      setEntries([]);
    }
  }

  return (
    <section className="panel assistant">
      <div className="row spread">
        <h2>Assistant</h2>
        {entries.length > 0 && (
          <button className="secondary small fit" type="button" onClick={startOver} disabled={busy}>
            New conversation
          </button>
        )}
      </div>
      <div className="chat" aria-live="polite">
        {entries.length === 0 && (
          <div className="chat-empty">
            <p>
              Hi {p.firstName}. Ask about your meetings, open times and booking links, get help writing to invitees, or have me set
              things up. I&apos;ll always ask before changing anything.
            </p>
            <div className="chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="secondary small" onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.map((e, i) =>
          e.role === "action" ? (
            <div key={i} className={`chat-action ${e.action.status}`}>
              <strong>{e.action.kind === "cancel_meeting" ? "Cancel meeting?" : "Create event type?"}</strong>
              <p>{e.action.summary}</p>
              {e.action.status === "pending" ? (
                <div className="row">
                  <button className="primary small" type="button" disabled={busy} onClick={() => decide(e.action.id, true)}>
                    Confirm
                  </button>
                  <button className="secondary small" type="button" disabled={busy} onClick={() => decide(e.action.id, false)}>
                    Dismiss
                  </button>
                </div>
              ) : (
                <p className="small muted">
                  {e.action.status === "done" ? "Done. " : e.action.status === "failed" ? "Failed: " : ""}
                  {e.action.status === "dismissed" ? "Dismissed" : <RichText text={e.action.result ?? ""} />}
                </p>
              )}
            </div>
          ) : (
            <div key={i} className={`chat-msg ${e.role}`}>
              <RichText text={e.text} />
            </div>
          ),
        )}
        {busy && <div className="chat-msg assistant muted">Thinking…</div>}
        <div ref={end} />
      </div>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <textarea
          value={text}
          rows={2}
          maxLength={4000}
          placeholder="Ask about your schedule…"
          aria-label="Message"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(text);
            }
          }}
        />
        <button className="primary" type="submit" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
      <p className="muted small">The assistant can make mistakes. Check times and details before you share them.</p>
    </section>
  );
}

const TOKEN_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|\*\*[^*]+\*\*)/g;

/** Plain text with clickable links and **bold**; line breaks are kept by CSS. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN_RE).map((part, i) =>
        i % 2 === 0 ? (
          <Fragment key={i}>{part}</Fragment>
        ) : part.startsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer">
            {part}
          </a>
        ),
      )}
    </>
  );
}
