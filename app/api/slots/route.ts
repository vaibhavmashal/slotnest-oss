import { NextResponse, type NextRequest } from "next/server";
import { getBookingForManage, getSlots } from "@/lib/booking/service";
import { errorResponse } from "@/lib/http";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const [user, event, from, to] = ["user", "event", "from", "to"].map((k) => p.get(k));
  if (!user || !event || !from || !to) return NextResponse.json({ error: "user, event, from and to are required" }, { status: 400 });
  try {
    // When rescheduling, the booking's current time must not block itself; requires the manage token.
    // A booking keeps its hosts, so only times they're all free are offered.
    let reschedule: Parameters<typeof getSlots>[4];
    const rescheduleId = p.get("reschedule");
    if (rescheduleId) {
      const row = await getBookingForManage(rescheduleId, p.get("t") ?? "");
      if (!row) return NextResponse.json({ error: "Invalid link" }, { status: 403 });
      reschedule = { bookingId: rescheduleId, hosts: row.hosts };
    }
    return NextResponse.json({ slots: await getSlots(user, event, from, to, reschedule) });
  } catch (err) {
    return errorResponse(err);
  }
}
