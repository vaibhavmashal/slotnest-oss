"use client";

import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { groupSlotsByLocalDate, type Slot } from "@/lib/availability/engine";
import type { BookingQuestion } from "@/db/schema";
import { canonicalZone, zoneLabel } from "@/lib/timezones";
import { brandClass, brandStyle, HostIdentity, PoweredBy, type PageBranding } from "./Brand";
import { ZoneOptions } from "./TimeZoneSelect";
import { googleCalendarUrl, icsFile, outlookCalendarUrl } from "@/lib/calendar-links";

interface Props {
  embed: boolean;
  user: string;
  event: string;
  hostName: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  locationKind: string;
  bookingWindowDays: number;
  /** Reschedule an existing booking instead of creating one. */
  reschedule?: { bookingId: string; token: string; currentStart: string; onBack: () => void };
  branding?: PageBranding;
  /** The event type's own questions (new bookings only). */
  questions?: BookingQuestion[];
  /** Paid event types: the formatted price, paid with Stripe after choosing a time. */
  price?: string | null;
  /** Name, email and answers passed in the link (?name=&email=&a_{questionId}=), e.g. from a routing form. */
  prefill?: { name?: string; email?: string; answers?: Record<string, string> };
}

const LOCATION_LABEL: Record<string, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  phone: "Phone call",
  in_person: "In person",
  custom: "See confirmation",
};

const browserZone = () => canonicalZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
/** "h:mm a" where the visitor's locale uses a 12-hour clock (US, Canada, Australia, India …), else "HH:mm". */
const browserClock = () => (/h1[12]/.test(new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle ?? "") ? "h:mm a" : "HH:mm");

function postToParent(type: string, payload: unknown) {
  if (window.parent !== window) window.parent.postMessage({ source: "slotnest", type, payload }, "*");
}

export default function BookingClient(p: Props) {
  // Zone list and default come from the browser after mount (server and browser ICU data differ).
  const [timeZone, setTimeZone] = useState<string>("UTC");
  const [homeZone, setHomeZone] = useState<string | null>(null);
  const [clock, setClock] = useState("HH:mm");
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState<Slot | null>(null);
  // Round-robin: the team member the booking was assigned to.
  const [assignedHost, setAssignedHost] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Embedded: blend into the host page instead of painting our own page background.
  useEffect(() => {
    if (p.embed) document.body.style.background = "transparent";
  }, [p.embed]);

  useEffect(() => {
    const zone = browserZone();
    setHomeZone(zone);
    setTimeZone(zone);
    setClock(browserClock());
  }, []);

  useEffect(() => {
    const from = DateTime.utc();
    const to = from.plus({ days: Math.min(p.bookingWindowDays, 60) });
    const q = new URLSearchParams({ user: p.user, event: p.event, from: from.toISO()!, to: to.toISO()! });
    if (p.reschedule) {
      q.set("reschedule", p.reschedule.bookingId);
      q.set("t", p.reschedule.token);
    }
    setSlots(null);
    fetch(`/api/slots?${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setSlots(d.slots))
      .catch(() => setError("Could not load available times. Please refresh."));
  }, [p.user, p.event, p.bookingWindowDays, p.reschedule?.bookingId, p.reschedule?.token, reloadKey]);

  const days = useMemo(() => (slots ? groupSlotsByLocalDate(slots, timeZone) : []), [slots, timeZone]);
  const activeDay = days.find((d) => d.date === date) ?? days[0];

  useEffect(() => postToParent("resize", { height: document.body.scrollHeight }), [days, selected, confirmed]);

  async function submit(form: FormData) {
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    const res = p.reschedule
      ? await fetch(`/api/bookings/${p.reschedule.bookingId}/reschedule`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: p.reschedule.token, start: selected.start }),
        })
      : await fetch("/api/bookings", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            user: p.user,
            event: p.event,
            start: selected.start,
            name: form.get("name"),
            email: form.get("email"),
            notes: form.get("notes") || undefined,
            answers: Object.fromEntries((p.questions ?? []).map((q) => [q.id, String(form.get(`q:${q.id}`) ?? "")])),
            timeZone,
          }),
        });
    setSubmitting(false);
    if (res.ok) {
      const body = p.reschedule ? null : await res.json().catch(() => null);
      if (body?.checkoutUrl) {
        // Paid event: on to Stripe Checkout (it can't run inside an iframe, so embeds move the host page).
        if (p.embed && window.parent !== window) postToParent("redirect", { url: body.checkoutUrl });
        else window.location.assign(body.checkoutUrl);
        return;
      }
      if (body?.redirectUrl) {
        // Embedded: the host page navigates itself (an iframe can't reliably move its parent); otherwise go there now.
        postToParent("booked", { start: selected.start, end: selected.end });
        if (p.embed && window.parent !== window) postToParent("redirect", { url: body.redirectUrl });
        else window.location.assign(body.redirectUrl);
        return;
      }
      if (body) setAssignedHost(body.booking?.hostName ?? null);
      setConfirmed(selected);
      postToParent("booked", { start: selected.start, end: selected.end });
      return;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 409) {
      setError("Sorry, that time was just taken. Please pick another.");
      setSelected(null);
      setReloadKey((k) => k + 1);
    } else {
      setError(body.error ?? "Something went wrong. Please try again.");
    }
  }

  const fmt = (iso: string, f: string) => DateTime.fromISO(iso).setZone(timeZone).toFormat(f);
  const span = (s: Slot) => `${fmt(s.start, clock)}–${fmt(s.end, clock)}`;
  // Times are only as right as the zone they're shown in, and browsers can report the wrong one (privacy modes report
  // UTC), so say it next to the times and make it easy to change.
  const zoneNote = homeZone && (
    <p className="tz-note">
      Times are in <strong>{zoneLabel(timeZone)}</strong>.{" "}
      <button type="button" className="link inline" onClick={() => document.getElementById("booking-tz")?.focus()}>
        Change
      </button>
    </p>
  );

  if (confirmed) {
    const host = assignedHost ?? p.hostName;
    const entry = {
      title: `${p.title} with ${host}`,
      start: confirmed.start,
      end: confirmed.end,
      details: "Booked with Slotnest. The joining details and the links to reschedule or cancel are in your confirmation email.",
      location: p.locationKind === "custom" ? undefined : LOCATION_LABEL[p.locationKind],
    };
    const ics = icsFile(entry, `${confirmed.start}-${p.user}-${p.event}@slotnest`);
    return (
      <main className={`booking ${p.embed ? "embed" : ""} ${brandClass(p.branding)}`} style={brandStyle(p.branding)}>
        <section className="card confirm">
          <HostIdentity b={p.branding} hostName={p.hostName} />
          <h1>{p.reschedule ? "Rescheduled" : "You're booked"}</h1>
          <p>
            <strong>{p.title}</strong> with {assignedHost ?? p.hostName}
          </p>
          <p>
            {fmt(confirmed.start, "cccc, d LLLL yyyy")}
            <br />
            {span(confirmed)} ({zoneLabel(timeZone)})
          </p>
          <p className="muted">
            {p.reschedule ? "An updated calendar invitation is on its way to your inbox." : "A calendar invitation is on its way to your inbox."}
          </p>
          {!p.reschedule && (
            <p className="add-cal">
              <span className="muted small">Add to calendar:</span>{" "}
              <a href={googleCalendarUrl(entry)} target="_blank" rel="noopener noreferrer">
                Google
              </a>{" "}
              ·{" "}
              <a href={outlookCalendarUrl(entry)} target="_blank" rel="noopener noreferrer">
                Outlook
              </a>{" "}
              · <a href={`data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`} download="meeting.ics">
                Apple / other (.ics)
              </a>
            </p>
          )}
        </section>
        <PoweredBy b={p.branding} />
      </main>
    );
  }

  return (
    <main className={`booking ${p.embed ? "embed" : ""} ${brandClass(p.branding)}`} style={brandStyle(p.branding)}>
      <section className="card">
        <aside className="info">
          <HostIdentity b={p.branding} hostName={p.hostName} />
          <h1>{p.title}</h1>
          <p className="meta">
            {p.durationMinutes} min · {LOCATION_LABEL[p.locationKind] ?? p.locationKind}
            {p.price && <> · {p.price}</>}
          </p>
          {p.description && <p className="desc">{p.description}</p>}
          <label className="tz">
            Time zone
            <select id="booking-tz" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
              <ZoneOptions value={timeZone} pinned={homeZone ?? timeZone} ready={homeZone !== null} />
            </select>
          </label>
        </aside>

        <div className="picker">
          {p.reschedule && (
            <p className="notice">
              Rescheduling your meeting on {fmt(p.reschedule.currentStart, `cccc, d LLLL 'at' ${clock}`)}.{" "}
              <button type="button" className="link inline" onClick={p.reschedule.onBack}>
                Keep the current time
              </button>
            </p>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          {!slots && !error && <p className="muted">Loading available times…</p>}
          {slots && days.length === 0 && <p className="muted">No times available in the next {p.bookingWindowDays} days.</p>}

          {activeDay && !selected && (
            <>
              <h2>Select a date</h2>
              <div className="dates" role="listbox" aria-label="Dates">
                {days.map((d) => (
                  <button
                    key={d.date}
                    role="option"
                    aria-selected={d.date === activeDay.date}
                    className={d.date === activeDay.date ? "date active" : "date"}
                    onClick={() => setDate(d.date)}
                  >
                    <span>{DateTime.fromISO(d.date).toFormat("ccc")}</span>
                    <strong>{DateTime.fromISO(d.date).toFormat("d")}</strong>
                    <span>{DateTime.fromISO(d.date).toFormat("LLL")}</span>
                  </button>
                ))}
              </div>
              <h2>{DateTime.fromISO(activeDay.date).toFormat("cccc, d LLLL")}</h2>
              {zoneNote}
              <div className="times">
                {activeDay.slots.map((s) => (
                  <button key={s.start} className="time" onClick={() => setSelected(s)}>
                    {fmt(s.start, clock)}
                    {s.seatsLeft !== undefined && <small className="seats">{s.seatsLeft === 1 ? "1 spot left" : `${s.seatsLeft} spots left`}</small>}
                  </button>
                ))}
              </div>
            </>
          )}

          {selected && (
            <form action={submit} className="details">
              <button type="button" className="link" onClick={() => setSelected(null)}>
                ← Back
              </button>
              <h2>
                {fmt(selected.start, "cccc, d LLLL")} · {span(selected)}
              </h2>
              {zoneNote}
              {!p.reschedule && (
                <>
                  <label>
                    Name
                    <input name="name" required autoComplete="name" defaultValue={p.prefill?.name} />
                  </label>
                  <label>
                    Email
                    <input name="email" type="email" required autoComplete="email" defaultValue={p.prefill?.email} />
                  </label>
                  {p.questions?.map((q) => (
                    <QuestionField key={q.id} q={q} defaultValue={p.prefill?.answers?.[q.id]} />
                  ))}
                  <label>
                    <span>
                      Anything we should know? <span className="muted">(optional)</span>
                    </span>
                    <textarea name="notes" rows={3} />
                  </label>
                </>
              )}
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? "Saving…" : p.reschedule ? "Confirm new time" : p.price ? `Continue to payment (${p.price})` : "Confirm booking"}
              </button>
            </form>
          )}
        </div>
      </section>
      <PoweredBy b={p.branding} />
    </main>
  );
}

/** One custom question as a form field named `q:{id}` (also used by routing forms). */
export function QuestionField({ q, defaultValue }: { q: BookingQuestion; defaultValue?: string }) {
  const name = `q:${q.id}`;
  const label = (
    <span>
      {q.label} {!q.required && <span className="muted">(optional)</span>}
    </span>
  );
  switch (q.type) {
    case "textarea":
      return (
        <label>
          {label}
          <textarea name={name} rows={3} required={q.required} maxLength={2000} defaultValue={defaultValue} />
        </label>
      );
    case "select":
      return (
        <label>
          {label}
          <select name={name} required={q.required} defaultValue={q.options?.includes(defaultValue ?? "") ? defaultValue : ""}>
            <option value="" disabled={q.required}>
              Choose…
            </option>
            {q.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      );
    default:
      return (
        <label>
          {label}
          <input name={name} type={q.type === "phone" ? "tel" : "text"} autoComplete={q.type === "phone" ? "tel" : "off"} required={q.required} maxLength={2000} defaultValue={defaultValue} />
        </label>
      );
  }
}
