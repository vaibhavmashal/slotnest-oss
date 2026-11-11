import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createBooking } from "@/lib/booking/service";
import { errorResponse } from "@/lib/http";
import { joinNames } from "@/lib/teams";
import { bookingRedirect } from "@/lib/urls";

const Body = z.object({
  user: z.string().min(1),
  event: z.string().min(1),
  start: z.iso.datetime({ offset: true }),
  name: z.string().trim().min(1).max(200),
  email: z.email().max(320),
  timeZone: z.string().min(1).max(64),
  notes: z.string().max(2000).optional(),
  answers: z.record(z.string().max(16), z.string().max(2000)).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  const b = parsed.data;
  try {
    const { booking, hosts, eventType, checkoutUrl } = await createBooking({
      handle: b.user,
      slug: b.event,
      start: b.start,
      inviteeName: b.name,
      inviteeEmail: b.email,
      inviteeTimeZone: b.timeZone,
      notes: b.notes,
      answers: b.answers,
    });
    const start = booking.startAt.toISOString();
    const end = booking.endAt.toISOString();
    if (checkoutUrl) {
      // Paid event: pay first; the redirect to the host's own page (if any) doesn't apply until confirmed.
      return NextResponse.json({ booking: { id: booking.id, start: booking.startAt.toISOString(), end: booking.endAt.toISOString() }, checkoutUrl }, { status: 201 });
    }
    const redirectUrl = eventType.redirectUrl
      ? bookingRedirect(eventType.redirectUrl, eventType.redirectPassDetails, {
          name: booking.inviteeName,
          email: booking.inviteeEmail,
          start,
          end,
          eventTitle: eventType.title,
        })
      : null;
    return NextResponse.json(
      { booking: { id: booking.id, start, end, hostName: joinNames(hosts.map((h) => h.name)) }, redirectUrl },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
