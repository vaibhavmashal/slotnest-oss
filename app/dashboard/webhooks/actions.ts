"use server";

import { redirect } from "next/navigation";
import type { WebhookEvent } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { hasPaidFeatures } from "@/lib/teams";
import { createWebhook, deleteWebhook, sendTestPing, WebhookError } from "@/lib/webhooks";

const back = (q: Record<string, string>) => redirect(`/dashboard/webhooks?${new URLSearchParams(q)}`);

export async function addWebhook(form: FormData) {
  const user = await requireUser();
  const url = String(form.get("url") ?? "").trim();
  if (!(await hasPaidFeatures(user))) back({ error: "Webhooks are part of the paid plans. Upgrade on the Billing page.", url });
  try {
    const w = await createWebhook(user.id, url, form.getAll("events").map(String) as WebhookEvent[]);
    back({ added: w.id });
  } catch (err) {
    if (err instanceof WebhookError) back({ error: err.message, url });
    throw err;
  }
}

export async function removeWebhook(form: FormData) {
  const user = await requireUser();
  await deleteWebhook(user.id, String(form.get("id")));
  back({ removed: "1" });
}

export async function testWebhook(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id"));
  try {
    const { status } = await sendTestPing(user.id, id);
    back({ tested: id, status: String(status) });
  } catch (err) {
    if (err instanceof WebhookError) back({ tested: id, error: err.message });
    throw err;
  }
}
