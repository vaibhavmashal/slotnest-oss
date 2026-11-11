import { NextResponse, type NextRequest } from "next/server";
import { getBookingForManage } from "@/lib/booking/service";
import { config } from "@/lib/config";
import { abandonCheckout } from "@/lib/payments";
import { eventContext } from "@/lib/teams";

/** The invitee left Stripe Checkout without paying: release the held time and send them back to pick again. */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("b") ?? "";
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const row = await getBookingForManage(id, token);
  if (!row) return NextResponse.redirect(new URL("/", config.appUrl));
  // They may have paid after all (e.g. pressed back after paying): then show the booking, not the calendar.
  if ((await abandonCheckout(id)) === "paid") return NextResponse.redirect(new URL(`/b/${id}?t=${token}&paid=1`, config.appUrl));
  const ctx = await eventContext(row.eventType, row.host);
  const back = new URL(`/${ctx.handle}/${row.eventType.slug}`, config.appUrl);
  back.searchParams.set("name", row.booking.inviteeName);
  back.searchParams.set("email", row.booking.inviteeEmail);
  return NextResponse.redirect(back);
}
