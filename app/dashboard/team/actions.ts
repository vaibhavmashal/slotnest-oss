"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { teams } from "@/db/schema";
import { requireUser } from "@/lib/auth/session";
import { createTeam, inviteMember, ownedTeam, removeMember, revokeInvite, TeamError, toHandle } from "@/lib/teams";

/** Run a team operation and come back to the Team page with its outcome. */
async function run(fn: () => Promise<unknown>, done: string, keep: Record<string, string> = {}): Promise<never> {
  try {
    await fn();
  } catch (err) {
    // `keep` refills the form, so a rejected entry can be corrected instead of retyped.
    if (err instanceof TeamError) redirect(`/dashboard/team?${new URLSearchParams({ error: err.code, ...keep })}`);
    throw err;
  }
  redirect(`/dashboard/team?done=${done}`);
}

async function requireOwnedTeam() {
  const user = await requireUser();
  const team = await ownedTeam(user.id);
  if (!team) redirect("/dashboard/team");
  return { user, team: team! };
}

export async function createTeamAction(form: FormData) {
  const user = await requireUser();
  const name = String(form.get("name") ?? "").slice(0, 100);
  const slug = toHandle(String(form.get("slug") ?? "")).slice(0, 60);
  await run(() => createTeam(user, name, slug), "created", { name, slug });
}

export async function inviteAction(form: FormData) {
  const { user, team } = await requireOwnedTeam();
  await run(() => inviteMember(team, user, String(form.get("email") ?? "")), "invited");
}

export async function revokeInviteAction(form: FormData) {
  const { team } = await requireOwnedTeam();
  await run(() => revokeInvite(team, String(form.get("id"))), "revoked");
}

export async function removeMemberAction(form: FormData) {
  const { team } = await requireOwnedTeam();
  await run(() => removeMember(team, String(form.get("userId"))), "removed");
}

export async function leaveTeamAction(form: FormData) {
  const user = await requireUser();
  const [team] = await db.select().from(teams).where(eq(teams.id, String(form.get("teamId"))));
  if (!team) redirect("/dashboard/team");
  await run(() => removeMember(team, user.id), "left");
}
