import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { calendarConnections } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { refreshTokens, type Provider, type TokenSet } from "./oauth";

export type Connection = typeof calendarConnections.$inferSelect;

const REFRESH_MARGIN_MS = 2 * 60_000;

export async function saveConnection(userId: string, provider: Provider, accountEmail: string, tokens: TokenSet) {
  const isCalendar = provider !== "zoom";
  // The first calendar connected becomes the write target (where booked events are created).
  const existing = await listConnections(userId);
  const hasWriteTarget = existing.some((c) => c.isWriteTarget);
  const values = {
    accessTokenEnc: encrypt(tokens.accessToken),
    refreshTokenEnc: encrypt(tokens.refreshToken),
    tokenExpiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    lastError: null,
    lastErrorAt: null,
  };
  await db
    .insert(calendarConnections)
    .values({
      userId,
      provider,
      accountEmail,
      ...values,
      checkForConflicts: isCalendar,
      isWriteTarget: isCalendar && !hasWriteTarget,
    })
    .onConflictDoUpdate({
      target: [calendarConnections.userId, calendarConnections.provider, calendarConnections.accountEmail],
      set: values,
    });
}

export function listConnections(userId: string) {
  return db.select().from(calendarConnections).where(eq(calendarConnections.userId, userId));
}

export async function getConnection(userId: string, id: string) {
  const [c] = await db.select().from(calendarConnections).where(and(eq(calendarConnections.userId, userId), eq(calendarConnections.id, id)));
  return c ?? null;
}

export async function getConnectionById(id: string) {
  const [c] = await db.select().from(calendarConnections).where(eq(calendarConnections.id, id));
  return c ?? null;
}

/** A valid access token, refreshing (and persisting rotated refresh tokens) when close to expiry. */
export async function accessToken(c: Connection): Promise<string> {
  if (c.tokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) return decrypt(c.accessTokenEnc);
  try {
    const t = await refreshTokens(c.provider, decrypt(c.refreshTokenEnc));
    await db
      .update(calendarConnections)
      .set({
        accessTokenEnc: encrypt(t.accessToken),
        refreshTokenEnc: encrypt(t.refreshToken),
        tokenExpiresAt: t.expiresAt,
        lastError: null,
        lastErrorAt: null,
      })
      .where(eq(calendarConnections.id, c.id));
    return t.accessToken;
  } catch (err) {
    await recordError(c.id, err);
    throw err;
  }
}

export async function recordError(connectionId: string, err: unknown) {
  await db
    .update(calendarConnections)
    .set({ lastError: String((err as Error)?.message ?? err).slice(0, 500), lastErrorAt: new Date() })
    .where(eq(calendarConnections.id, connectionId));
}
