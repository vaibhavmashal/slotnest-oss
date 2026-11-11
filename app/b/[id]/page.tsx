import { getBookingForManage } from "@/lib/booking/service";
import ManageClient from "./ManageClient";
import { checkPayment, formatPrice } from "@/lib/payments";
import { toPageBranding } from "@/lib/branding/page";
import { contextBranding, eventContext, joinNames } from "@/lib/teams";

export const dynamic = "force-dynamic";
export const metadata = { title: "Manage booking", robots: { index: false } };

type Params = Promise<{ id: string }>;
type Search = Promise<{ t?: string; paid?: string }>;

export default async function ManagePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const { t, paid } = await searchParams;
  let row = t ? await getBookingForManage(id, t) : null;
  // Back from Stripe Checkout: confirm the payment now rather than waiting for the background check.
  if (row && row.booking.paymentStatus === "pending") {
    await checkPayment(id).catch((err) => console.error("[payments] check failed", err));
    row = await getBookingForManage(id, t!);
  }
  if (!row) {
    return (
      <main className="booking">
        <section className="card confirm">
          <h1>Link not valid</h1>
          <p className="muted">This reschedule/cancel link is invalid. Please use the link from your confirmation email.</p>
        </section>
      </main>
    );
  }
  const { booking, eventType, host } = row!;
  const context = await eventContext(eventType, host);
  return (
    <ManageClient
      bookingId={booking.id}
      token={t!}
      status={booking.status}
      payment={
        booking.paymentStatus === "none"
          ? null
          : {
              status: booking.paymentStatus,
              price: formatPrice(booking.paymentAmount!, booking.paymentCurrency!),
              refundOnCancel: eventType.refundOnCancel,
              justPaid: paid === "1",
            }
      }
      start={booking.startAt.toISOString()}
      end={booking.endAt.toISOString()}
      inviteeTimeZone={booking.inviteeTimeZone}
      meetingUrl={booking.meetingUrl}
      title={eventType.title}
      hostName={joinNames(row!.hosts.map((h) => h.name))}
      user={context.handle}
      event={eventType.slug}
      durationMinutes={eventType.durationMinutes}
      locationKind={eventType.locationKind}
      bookingWindowDays={eventType.bookingWindowDays}
      description={eventType.description}
      branding={toPageBranding(await contextBranding(context))}
    />
  );
}
