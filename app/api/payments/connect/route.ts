import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { onboardingLink, PaymentError, paymentsAvailable } from "@/lib/payments";

/**
 * Start (or resume) Stripe onboarding for the signed-in host; a new account needs ?country=XX (the dashboard form
 * sends it). Stripe sends them back to /api/payments/return, or here again if the onboarding link expired.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", config.appUrl));
  if (!paymentsAvailable()) return NextResponse.redirect(new URL("/dashboard?error=stripe_not_configured", config.appUrl));
  try {
    return NextResponse.redirect(await onboardingLink(user, req.nextUrl.searchParams.get("country") ?? undefined));
  } catch (err) {
    if (err instanceof PaymentError) return NextResponse.redirect(new URL("/dashboard?payments=country#payments", config.appUrl));
    console.error("[payments] onboarding link failed", err);
    return NextResponse.redirect(new URL("/dashboard?payments=error", config.appUrl));
  }
}
