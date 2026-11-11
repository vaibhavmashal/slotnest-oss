import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { cancelBooking } from "@/lib/booking/service";
import { errorResponse } from "@/lib/http";

const Body = z.object({ token: z.string().min(10).max(200), reason: z.string().max(1000).optional() });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  try {
    await cancelBooking(id, { kind: "invitee", token: parsed.data.token }, parsed.data.reason);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
