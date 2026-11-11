"use client";

import { useState } from "react";
import { DateTime } from "luxon";
import BookingClient from "@/components/BookingClient";
import { brandClass, brandStyle, HostIdentity, PoweredBy, type PageBranding } from "@/components/Brand";

interface Props {
  bookingId: string;
  token: string;
  status: "confirmed" | "cancelled" | "rescheduled";
  start: string;
  end: string;
  inviteeTimeZone: string;
  meetingUrl: string | null;
  title: string;
  hostName: string;
  user: string;
  event: string;
  durationMinutes: number;
  locationKind: string;
  bookingWindowDays: number;
  description: string | null;
  branding: PageBranding;
  /** Paid bookings: payment status and price; `justPaid` when the invitee arrives back from Stripe Checkout. */
  payment: { status: "pending" | "paid" | "refunded" | "expired"; price: string; refundOnCancel: boolean; justPaid: boolean } | null;
}

export default function ManageClient(p: Props) {
  const [mode, setMode] = useState<"view" | "cancel" | "reschedule" | "cancelled">(p.status === "cancelled" ? "cancelled" : "view");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fmt = (iso: string, f: string) => DateTime.fromISO(iso).setZone(p.inviteeTimeZone).toFormat(f);
  const past = new Date(p.start).getTime() < Date.now();

  async function cancel() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/bookings/${p.bookingId}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: p.token, reason: reason || undefined }),
    });
    setBusy(false);
    if (res.ok) setMode("cancelled");
    else setError((await res.json().catch(() => ({}))).error ?? "Could not cancel. Please try again.");
  }

  if (mode === "reschedule") {
    return (
      <BookingClient
        embed={false}
        user={p.user}
        event={p.event}
        hostName={p.hostName}
        title={p.title}
        description={p.description}
        durationMinutes={p.durationMinutes}
        locationKind={p.locationKind}
        bookingWindowDays={p.bookingWindowDays}
        branding={p.branding}
        reschedule={{ bookingId: p.bookingId, token: p.token, currentStart: p.start, onBack: () => setMode("view") }}
      />
    );
  }

  return (
    <main className={`booking ${brandClass(p.branding)}`} style={brandStyle(p.branding)}>
      <section className="card confirm">
        <HostIdentity b={p.branding} hostName={p.hostName} />
        {mode === "cancelled" ? (
          <>
            <h1>{p.payment?.status === "expired" && p.status === "cancelled" ? "Payment not completed" : "Meeting cancelled"}</h1>
            <p>
              <strong>{p.title}</strong> with {p.hostName}
            </p>
            <p className="muted">
              {fmt(p.start, "cccc, d LLLL yyyy")} at {fmt(p.start, "HH:mm")}
            </p>
            {p.payment?.status === "expired" && <p className="muted">The time was released because the payment wasn&apos;t completed. You weren&apos;t charged.</p>}
            {p.payment?.status === "refunded" && <p className="muted">Your payment of {p.payment.price} was refunded.</p>}
            <p>
              <a href={`/${p.user}/${p.event}`}>Book a new time</a>
            </p>
          </>
        ) : (
          <>
            {p.payment?.justPaid && p.payment.status === "paid" && <p className="notice">Payment received. You&apos;re booked, and a confirmation email is on its way.</p>}
            {p.payment?.status === "pending" && (
              <p className="notice">We&apos;re waiting for your payment to come through. If you&apos;ve paid, refresh this page in a minute.</p>
            )}
            <h1>{p.title}</h1>
            <p>
              {fmt(p.start, "cccc, d LLLL yyyy")}
              <br />
              {fmt(p.start, "HH:mm")}–{fmt(p.end, "HH:mm")} ({p.inviteeTimeZone.replaceAll("_", " ")})
            </p>
            {p.meetingUrl && (
              <p>
                <a href={p.meetingUrl}>Join link</a>
              </p>
            )}
            {p.payment?.status === "paid" && <p className="muted small">Paid {p.payment.price}</p>}
            {error && <p className="error" role="alert">{error}</p>}
            {past ? (
              <p className="muted">This meeting has already started, so it can no longer be changed.</p>
            ) : mode === "cancel" ? (
              <div className="details center">
                {p.payment?.status === "paid" && (
                  <p className="muted small">
                    {p.payment.refundOnCancel ? `Your ${p.payment.price} payment will be refunded.` : "Payments for this meeting aren't refunded automatically; contact the host."}
                  </p>
                )}
                <label>
                  Reason for cancelling <span className="muted">(optional)</span>
                  <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <button className="primary danger" onClick={cancel} disabled={busy}>
                  {busy ? "Cancelling…" : "Cancel meeting"}
                </button>
                <button className="link" onClick={() => setMode("view")}>
                  Keep my meeting
                </button>
              </div>
            ) : (
              <div className="actions">
                <button className="primary" onClick={() => setMode("reschedule")}>
                  Reschedule
                </button>
                <button className="secondary" onClick={() => setMode("cancel")}>
                  Cancel
                </button>
              </div>
            )}
          </>
        )}
      </section>
      <PoweredBy b={p.branding} />
    </main>
  );
}
