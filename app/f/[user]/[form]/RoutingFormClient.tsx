"use client";

import { useState } from "react";
import type { BookingQuestion } from "@/db/schema";
import { brandClass, brandStyle, HostIdentity, PoweredBy, type PageBranding } from "@/components/Brand";
import { QuestionField } from "@/components/BookingClient";

interface Props {
  formId: string;
  title: string;
  description: string | null;
  hostName: string;
  questions: BookingQuestion[];
  branding: PageBranding;
}

export default function RoutingFormClient(p: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(form: FormData) {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/routing/${p.formId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        email: form.get("email"),
        answers: Object.fromEntries(p.questions.map((q) => [q.id, String(form.get(`q:${q.id}`) ?? "")])),
      }),
    }).catch(() => null);
    const body = await res?.json().catch(() => null);
    if (res?.ok && body?.redirect) {
      window.location.assign(body.redirect);
      return; // keep the button disabled while the next page loads
    }
    setSubmitting(false);
    if (res?.ok && body?.message) setMessage(body.message);
    else setError(body?.error ?? "Something went wrong. Please try again.");
  }

  return (
    <main className={`booking ${brandClass(p.branding)}`} style={brandStyle(p.branding)}>
      <section className="card confirm profile">
        <HostIdentity b={p.branding} hostName={p.hostName} />
        <h1>{p.title}</h1>
        {message ? (
          <p className="routing-message">{message}</p>
        ) : (
          <>
            {p.description && <p className="muted desc-line">{p.description}</p>}
            <form
              className="stack routing-form"
              onSubmit={(e) => {
                e.preventDefault();
                submit(new FormData(e.currentTarget));
              }}
            >
              <label>
                Name
                <input name="name" required autoComplete="name" maxLength={200} />
              </label>
              <label>
                Email
                <input name="email" type="email" required autoComplete="email" maxLength={320} />
              </label>
              {p.questions.map((q) => (
                <QuestionField key={q.id} q={q} />
              ))}
              {error && <p className="error">{error}</p>}
              <button type="submit" className="primary" disabled={submitting}>
                {submitting ? "One moment…" : "Continue"}
              </button>
            </form>
          </>
        )}
      </section>
      <PoweredBy b={p.branding} />
    </main>
  );
}
