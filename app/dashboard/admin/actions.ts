"use server";

import { redirect } from "next/navigation";
import { DateTime } from "luxon";
import { requireUser } from "@/lib/auth/session";
import {
  AdminError,
  removeTeamMember,
  revokeTeamInvite,
  setBonusSeats,
  setPaidSeats,
  setPlanAndBilling,
  setSuspended,
  type BillingChoice,
} from "@/lib/admin/manage";

/** Run one admin change for the account in the form, then go back to its page with a note or the error. */
async function change(form: FormData, done: string, run: (admin: Awaited<ReturnType<typeof requireUser>>, id: string) => Promise<void>) {
  const admin = await requireUser();
  const id = String(form.get("id") ?? "");
  let q: string;
  try {
    await run(admin, id);
    q = `ok=${encodeURIComponent(done)}`;
  } catch (err) {
    if (!(err instanceof AdminError)) throw err;
    q = `error=${encodeURIComponent(err.message)}`;
  }
  redirect(`/dashboard/admin/${id}?${q}`);
}

const int = (form: FormData, name: string) => Number(String(form.get(name) ?? "").trim() || NaN);

export async function saveBonusSeats(form: FormData) {
  await change(form, "Free seats saved.", (admin, id) => setBonusSeats(admin, id, int(form, "bonusSeats")));
}

export async function savePaidSeats(form: FormData) {
  await change(form, "Paid seats changed in Stripe.", (admin, id) => setPaidSeats(admin, id, int(form, "seats")));
}

export async function saveBilling(form: FormData) {
  await change(form, "Plan and status saved.", (admin, id) => {
    const plan = form.get("plan") === "team" ? "team" : "solo";
    const status = String(form.get("status"));
    let choice: BillingChoice;
    if (status === "trial") {
      // The trial runs to the end of that day in the admin's time zone.
      const end = DateTime.fromISO(String(form.get("trialEndsAt") ?? ""), { zone: admin.timeZone }).endOf("day");
      if (!end.isValid) throw new AdminError("Pick a trial end date");
      choice = { plan, status, trialEndsAt: end.toJSDate() };
    } else if (status === "comped" || status === "free") {
      choice = { plan, status };
    } else {
      throw new AdminError("Pick a status");
    }
    return setPlanAndBilling(admin, id, choice);
  });
}

export async function suspendAccount(form: FormData) {
  await change(form, "Account suspended: its booking pages are off.", (admin, id) => setSuspended(admin, id, true));
}

export async function restoreAccount(form: FormData) {
  await change(form, "Account restored.", (admin, id) => setSuspended(admin, id, false));
}

export async function removeMemberAction(form: FormData) {
  await change(form, "Member removed from the team.", (admin, id) => removeTeamMember(admin, id, String(form.get("memberId") ?? "")));
}

export async function revokeInviteAction(form: FormData) {
  await change(form, "Invite revoked.", (admin, id) => revokeTeamInvite(admin, id, String(form.get("inviteId") ?? "")));
}
