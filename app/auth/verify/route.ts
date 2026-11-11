import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { config } from "@/lib/config";
import { consumeLoginToken, issueOnboardingToken, safeNext, startSession } from "@/lib/auth/session";

export async function GET(req: NextRequest) {
  const email = await consumeLoginToken(req.nextUrl.searchParams.get("token") ?? "");
  if (!email) return NextResponse.redirect(new URL("/login?error=expired", config.appUrl));
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) {
    const token = await issueOnboardingToken(email);
    const then = next ? `&next=${encodeURIComponent(next)}` : "";
    return NextResponse.redirect(new URL(`/onboarding?token=${token}${then}`, config.appUrl));
  }
  await startSession(user.id);
  return NextResponse.redirect(new URL(next ?? "/dashboard", config.appUrl));
}
