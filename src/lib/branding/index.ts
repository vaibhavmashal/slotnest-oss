import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { assets, users } from "@/db/schema";
import { config } from "@/lib/config";
import { palette, type BrandPalette } from "./color";
import { inspectImage } from "./image";
import { assetStore } from "./store";

type User = typeof users.$inferSelect;
type Asset = typeof assets.$inferSelect;

export interface BrandImage {
  /** Path on this app, e.g. /assets/<id>.png. Use `absolute` in emails. */
  url: string;
  absolute: string;
  width: number;
  height: number;
}

export interface Branding {
  name: string;
  /** null = the account hasn't chosen a colour; Slotnest's default theme applies. */
  palette: BrandPalette | null;
  logo: BrandImage | null;
  avatar: BrandImage | null;
  /** Whether to show "Powered by Slotnest" (false only for paid accounts that turned it off). */
  showPoweredBy: boolean;
}

const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

export const assetPath = (a: Pick<Asset, "id" | "contentType">) => `/assets/${a.id}.${EXT[a.contentType]}`;

/**
 * Hiding "Powered by Slotnest" is a paid feature.
 * With Stripe configured: active or past_due (still in Stripe's retry period) accounts only; trials can't hide it.
 * Without Stripe (local development): controlled by UNBILLED_PAID_FEATURES (default on), so both paths can be tested.
 */
export function canHidePoweredBy(u: Pick<User, "billingStatus">): boolean {
  if (!config.stripe) return config.unbilledPaidFeatures;
  return u.billingStatus === "active" || u.billingStatus === "past_due";
}

/** The account's choice only counts while it may hide the mark; a lapsed plan shows it again automatically. */
export function showsPoweredBy(u: Pick<User, "billingStatus" | "hidePoweredBy">): boolean {
  return !(u.hidePoweredBy && canHidePoweredBy(u));
}

function image(a: Asset | undefined): BrandImage | null {
  if (!a) return null;
  const url = assetPath(a);
  return { url, absolute: `${config.appUrl}${url}`, width: a.width, height: a.height };
}

export async function getBranding(u: User): Promise<Branding> {
  const ids = [u.logoAssetId, u.avatarAssetId].filter((x): x is string => !!x);
  const rows = ids.length ? await db.select().from(assets).where(inArray(assets.id, ids)) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    name: u.name,
    palette: u.brandColor ? palette(u.brandColor) : null,
    logo: image(u.logoAssetId ? byId.get(u.logoAssetId) : undefined),
    avatar: image(u.avatarAssetId ? byId.get(u.avatarAssetId) : undefined),
    showPoweredBy: showsPoweredBy(u),
  };
}

/** Validate, store and attach a logo or profile photo, replacing (and deleting) the previous one. */
export async function saveBrandImage(userId: string, kind: "logo" | "avatar", bytes: Buffer): Promise<void> {
  const info = inspectImage(bytes);
  const id = randomUUID();
  const storageKey = `${userId}/${id}.${info.ext}`;
  await assetStore().put(storageKey, bytes, info.contentType);
  const column = kind === "logo" ? "logoAssetId" : "avatarAssetId";
  const previous = await db.transaction(async (tx) => {
    const [u] = await tx.select({ logo: users.logoAssetId, avatar: users.avatarAssetId }).from(users).where(eq(users.id, userId));
    await tx.insert(assets).values({
      id,
      userId,
      kind,
      contentType: info.contentType,
      byteSize: bytes.length,
      width: info.width,
      height: info.height,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      storageKey,
    });
    await tx.update(users).set({ [column]: id }).where(eq(users.id, userId));
    return kind === "logo" ? u.logo : u.avatar;
  });
  if (previous) await deleteAsset(userId, previous);
}

export async function removeBrandImage(userId: string, kind: "logo" | "avatar"): Promise<void> {
  const [u] = await db.select({ logo: users.logoAssetId, avatar: users.avatarAssetId }).from(users).where(eq(users.id, userId));
  const id = kind === "logo" ? u.logo : u.avatar;
  await db.update(users).set(kind === "logo" ? { logoAssetId: null } : { avatarAssetId: null }).where(eq(users.id, userId));
  if (id) await deleteAsset(userId, id);
}

async function deleteAsset(userId: string, id: string) {
  const [row] = await db.delete(assets).where(and(eq(assets.id, id), eq(assets.userId, userId))).returning();
  if (row) await assetStore().delete(row.storageKey);
}
