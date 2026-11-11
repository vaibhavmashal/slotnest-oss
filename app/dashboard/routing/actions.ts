"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { routingForms, routingSubmissions } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { parseQuestions } from "@/lib/booking/questions";
import { parseRules, parseTarget, routableEventTypes } from "@/lib/routing";
import { hasPaidFeatures } from "@/lib/teams";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const toSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "form";

/** Start a form with a title; everything else is set up in the editor. */
export async function createRoutingForm(form: FormData) {
  const user = await requireUser();
  if (!(await hasPaidFeatures(user))) redirect("/dashboard/routing?error=plan");
  const title = String(form.get("title") ?? "").trim().slice(0, 120);
  if (!title) redirect("/dashboard/routing?error=title");
  const taken = new Set((await db.select({ slug: routingForms.slug }).from(routingForms).where(eq(routingForms.userId, user.id))).map((r) => r.slug));
  const base = toSlug(title);
  let slug = base;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  const [first] = await routableEventTypes(user);
  const [row] = await db
    .insert(routingForms)
    .values({
      userId: user.id,
      slug,
      title,
      fallback: first ? { type: "event", eventTypeId: first.id } : { type: "message", text: "Thanks! We'll be in touch soon." },
    })
    .returning({ id: routingForms.id });
  redirect(`/dashboard/routing/${row.id}?created=1`);
}

export async function saveRoutingForm(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const back = (e: string) => redirect(`/dashboard/routing/${id}?error=${e}`);
  const mine = and(eq(routingForms.id, id), eq(routingForms.userId, user.id));
  const [existing] = await db.select({ id: routingForms.id }).from(routingForms).where(mine);
  if (!existing) redirect("/dashboard/routing");
  if (!(await hasPaidFeatures(user))) back("plan");

  const title = String(form.get("title") ?? "").trim().slice(0, 120);
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  if (!title) back("title");
  if (!SLUG_RE.test(slug)) back("slug");
  const questions = parseQuestions(String(form.get("questions") ?? "[]"));
  if (!questions) back("questions");
  const eventIds = new Set((await routableEventTypes(user)).map((e) => e.id));
  const routes = parseRules(String(form.get("rules") ?? "[]"), questions!, eventIds);
  if (!routes) back("rules");
  let fallbackRaw: unknown = null;
  try {
    fallbackRaw = JSON.parse(String(form.get("fallback") ?? "null"));
  } catch {}
  const fallback = parseTarget(fallbackRaw, eventIds);
  if (!fallback) back("fallback");

  const [clash] = await db.select({ id: routingForms.id }).from(routingForms).where(and(eq(routingForms.userId, user.id), eq(routingForms.slug, slug)));
  if (clash && clash.id !== id) back("slug-taken");

  await db
    .update(routingForms)
    .set({
      title,
      slug,
      description: String(form.get("description") ?? "").trim().slice(0, 2000) || null,
      isActive: form.get("isActive") === "on",
      questions: questions!,
      routes: routes!,
      fallback: fallback!,
    })
    .where(mine);
  redirect(`/dashboard/routing/${id}?saved=1`);
}

export async function deleteRoutingForm(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const [owned] = await db.select({ id: routingForms.id }).from(routingForms).where(and(eq(routingForms.id, id), eq(routingForms.userId, user.id)));
  if (owned) {
    await db.transaction(async (tx) => {
      await tx.delete(routingSubmissions).where(eq(routingSubmissions.formId, id));
      await tx.delete(routingForms).where(eq(routingForms.id, id));
    });
  }
  redirect("/dashboard/routing?deleted=1");
}
