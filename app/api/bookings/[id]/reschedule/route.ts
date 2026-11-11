import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { rescheduleBooking } from "@/lib/booking/service";
import { errorResponse } from "@/lib/http";

const Body = z.object({ token: z.string().min(10).max(200), start: z.iso.datetime({ offset: true }) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    const b = await rescheduleBooking(id, { kind: "invitee", token: parsed.data.token }, parsed.data.start);
    return NextResponse.json({ booking: { id: b.id, start: b.startAt.toISOString(), end: b.endAt.toISOString() } });
  } catch (err) {
    return errorResponse(err);
  }
}
