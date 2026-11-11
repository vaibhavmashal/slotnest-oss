import { NextResponse } from "next/server";
import { BookingError } from "@/lib/booking/service";

export function errorResponse(err: unknown) {
  if (err instanceof BookingError) {
    const status = { NOT_FOUND: 404, SLOT_UNAVAILABLE: 409, INVALID: 400, FORBIDDEN: 403, NOT_ACCEPTING: 403 }[err.code];
    return NextResponse.json({ error: err.message, code: err.code }, { status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal error" }, { status: 500 });
}
