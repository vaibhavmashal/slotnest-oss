import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { getCurrentUser } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { saveConnection } from "@/lib/integrations/connections";
import { exchangeCode, fetchAccountEmail, type Provider } from "@/lib/integrations/oauth";

const PROVIDERS: Provider[] = ["google", "microsoft", "zoom"];

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!PROVIDERS.includes(provider as Provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  const p = provider as Provider;
  const done = (q: string) => NextResponse.redirect(new URL(`/dashboard?${q}`, config.appUrl));

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", config.appUrl));

  const jar = await cookies();
  const expected = jar.get(`oauth_state_${p}`)?.value ?? "";
  jar.delete(`oauth_state_${p}`);
  const state = req.nextUrl.searchParams.get("state") ?? "";
  if (!expected || expected.length !== state.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(state))) {
    return done(`error=${p}_state_mismatch`);
  }
  const code = req.nextUrl.searchParams.get("code");
  if (!code) return done(`error=${p}_${req.nextUrl.searchParams.get("error") ?? "denied"}`);

  try {
    const tokens = await exchangeCode(p, code);
    const email = await fetchAccountEmail(p, tokens);
    await saveConnection(user.id, p, email, tokens);
    return done(`connected=${p}`);
  } catch (err) {
    console.error(`[oauth] ${p} callback failed`, err);
    return done(`error=${p}_connect_failed`);
  }
}
