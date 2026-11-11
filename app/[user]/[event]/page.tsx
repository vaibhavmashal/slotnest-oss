import { notFound } from "next/navigation";
import { getPublicEvent, isAccepting } from "@/lib/booking/service";
import BookingClient from "@/components/BookingClient";
import { toPageBranding } from "@/lib/branding/page";
import { contextBranding } from "@/lib/teams";
import { formatPrice } from "@/lib/payments/currencies";

export const dynamic = "force-dynamic";

// `user` is a handle: a username or a team slug (they share one namespace).
type Params = Promise<{ user: string; event: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }) {
  const { user, event } = await params;
  const row = await getPublicEvent(user, event);
  return { title: row ? `${row.eventType.title} · ${row.context.displayName}` : "Not found" };
}

export default async function BookingPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { user, event } = await params;
  const search = await searchParams;
  const { embed, name, email } = search;
  const row = await getPublicEvent(user, event);
  if (!row) notFound();
  const { eventType, context } = row;
  // Switched off by the plan (e.g. a second event type on Free) or a suspension: say so instead of "no times".
  if (!(await isAccepting(row))) {
    return (
      <main className={`booking ${embed === "1" ? "embed" : ""}`}>
        <section className="card confirm">
          <h1>{eventType.title}</h1>
          <p className="muted">{context.displayName} isn&apos;t taking bookings on this page right now.</p>
        </section>
      </main>
    );
  }
  return (
    <BookingClient
      embed={embed === "1"}
      user={user}
      event={event}
      hostName={context.displayName}
      title={eventType.title}
      description={eventType.description}
      durationMinutes={eventType.durationMinutes}
      locationKind={eventType.locationKind}
      price={eventType.priceAmount && eventType.priceCurrency ? formatPrice(eventType.priceAmount, eventType.priceCurrency) : null}
      bookingWindowDays={eventType.bookingWindowDays}
      questions={eventType.questions}
      prefill={{
        name: typeof name === "string" ? name.slice(0, 200) : undefined,
        email: typeof email === "string" ? email.slice(0, 320) : undefined,
        answers: Object.fromEntries(
          eventType.questions.flatMap((q) => {
            const v = search[`a_${q.id}`];
            return typeof v === "string" ? [[q.id, v.slice(0, 2000)]] : [];
          }),
        ),
      }}
      branding={toPageBranding(await contextBranding(context))}
    />
  );
}
