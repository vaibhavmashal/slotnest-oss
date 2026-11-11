"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { canHidePoweredBy, removeBrandImage, saveBrandImage } from "@/lib/branding";
import { normalizeHex } from "@/lib/branding/color";
import { ImageError } from "@/lib/branding/image";

export interface ActionState {
  ok?: string;
  error?: string;
}

export async function uploadBrandImage(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  const kind = form.get("kind") === "avatar" ? "avatar" : "logo";
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image to upload." };
  try {
    await saveBrandImage(user.id, kind, Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    if (err instanceof ImageError) return { error: err.message };
    throw err;
  }
  revalidatePath("/dashboard/branding");
  return { ok: kind === "logo" ? "Logo updated." : "Profile photo updated." };
}

export async function removeImage(form: FormData) {
  const user = await requireUser();
  await removeBrandImage(user.id, form.get("kind") === "avatar" ? "avatar" : "logo");
  revalidatePath("/dashboard/branding");
}

export async function saveBrandColor(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser();
  if (form.get("op") === "reset") {
    await db.update(users).set({ brandColor: null }).where(eq(users.id, user.id));
    revalidatePath("/dashboard/branding");
    return { ok: "Using the default Slotnest colour." };
  }
  const hex = normalizeHex(String(form.get("color") ?? ""));
  if (!hex) return { error: "Enter a colour like #2f5bea." };
  await db.update(users).set({ brandColor: hex }).where(eq(users.id, user.id));
  revalidatePath("/dashboard/branding");
  return { ok: "Brand colour saved." };
}

export async function savePoweredBy(form: FormData) {
  const user = await requireUser();
  const hide = form.get("hide") === "on";
  // Only paid accounts can hide it; a free account's request is ignored (the page explains why).
  if (hide && !canHidePoweredBy(user)) return;
  await db.update(users).set({ hidePoweredBy: hide }).where(eq(users.id, user.id));
  revalidatePath("/dashboard/branding");
}
