import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { loginTokens, sessions, users } from "@/db/schema";
import { config } from "@/lib/config";
import { newToken, sha256 } from "@/lib/crypto";
import { sendEmail } from "@/lib/email/send";
import { render } from "@/lib/email/templates";

const SESSION_COOKIE = "sid";
const SESSION_DAYS = 30;
const LOGIN_TOKEN_MINUTES = 15;

export type CurrentUser = typeof users.$inferSelect;

/**
 * Where to go after signing in, from a query or form value. Only team invite pages are allowed, so the
 * parameter can't be used as an open redirect.
 */
export function safeNext(v: FormDataEntryValue | string | null | undefined): string | null {
  const s = typeof v === "string" ? v : "";
  return /^\/invite\/[A-Za-z0-9_-]{20,100}$/.test(s) ? s : null;
}

/** Email a one-time sign-in link. Responds the same whether or not the email has an account. */
export async function requestLoginLink(email: string, next?: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  const token = newToken();
  await db.insert(loginTokens).values({
    tokenHash: sha256(token),
    email: normalized,
    expiresAt: new Date(Date.now() + LOGIN_TOKEN_MINUTES * 60_000),
  });
  const url = `${config.appUrl}/auth/verify?token=${token}${safeNext(next) ? `&next=${encodeURIComponent(next!)}` : ""}`;
  const body = render({
    heading: "Your sign-in link",
    lines: [`This link signs you in to Slotnest. It expires in ${LOGIN_TOKEN_MINUTES} minutes and works once.`, "If you didn't ask for it, you can ignore this email."],
    link: { label: "Sign in", url },
  });
  await sendEmail({ to: normalized, subject: "Sign in to Slotnest", ...body });
}

/** Consume a one-time token (sign-in or onboarding). Returns the verified email, or null. */
export async function consumeLoginToken(token: string): Promise<string | null> {
  const [row] = await db
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.tokenHash, sha256(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
    .returning({ email: loginTokens.email });
  return row?.email ?? null;
}

/** Peek at a token without consuming it (used to render the onboarding form). */
export async function peekLoginToken(token: string): Promise<string | null> {
  const [row] = await db
    .select({ email: loginTokens.email })
    .from(loginTokens)
    .where(and(eq(loginTokens.tokenHash, sha256(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())));
  return row?.email ?? null;
}

/** Issue a fresh single-use token for an already-verified email (sign-in → onboarding hand-off). */
export async function issueOnboardingToken(email: string): Promise<string> {
  const token = newToken();
  await db.insert(loginTokens).values({ tokenHash: sha256(token), email, expiresAt: new Date(Date.now() + 60 * 60_000) });
  return token;
}

export async function startSession(userId: string): Promise<void> {
  const id = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({ idHash: sha256(id), userId, expiresAt });
  (await cookies()).set(SESSION_COOKIE, id, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, sha256(id)), gt(sessions.expiresAt, new Date())));
  return row?.user ?? null;
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await db.delete(sessions).where(eq(sessions.idHash, sha256(id)));
  jar.delete(SESSION_COOKIE);
}
