import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/session";
import { newToken } from "@/lib/crypto";
import { config } from "@/lib/config";
import { authorizeUrl, isConfigured, type Provider } from "@/lib/integrations/oauth";

const PROVIDERS: Provider[] = ["google", "microsoft", "zoom"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!PROVIDERS.includes(provider as Provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  if (!(await getCurrentUser())) return NextResponse.redirect(new URL("/login", config.appUrl));
  if (!isConfigured(provider as Provider)) {
    return NextResponse.redirect(new URL(`/dashboard?error=${provider}_not_configured`, config.appUrl));
  }
  const state = newToken();
  (await cookies()).set(`oauth_state_${provider}`, state, { httpOnly: true, secure: config.isProd, sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(authorizeUrl(provider as Provider, state));
}
