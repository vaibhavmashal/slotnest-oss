import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { refreshAccount } from "@/lib/payments";

/** Back from Stripe onboarding: record whether the account can take payments yet. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", config.appUrl));
  const enabled = await refreshAccount(user).catch(() => false);
  return NextResponse.redirect(new URL(`/dashboard?payments=${enabled ? "connected" : "pending"}`, config.appUrl));
}
