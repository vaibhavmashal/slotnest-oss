"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { availabilityRules, calendarConnections, dateOverrides, eventTypeHosts, eventTypes, schedules, teamMembers, users } from "@/db/schema";
import { endSession, requireUser } from "@/lib/auth/session";
import { BookingError, cancelBooking } from "@/lib/booking/service";
import { parseQuestions } from "@/lib/booking/questions";
import { parseReminders } from "@/lib/booking/reminders";
import { disconnectAccount, parsePrice } from "@/lib/payments";
import { isHttpsUrl } from "@/lib/urls";
import { hasPaidFeatures, ownedTeam } from "@/lib/teams";
import { FREE_EVENT_TYPES } from "@/lib/billing/access";
import { cleanZone } from "@/lib/timezones";

const hm = (v: FormDataEntryValue | null) => {
  const m = /^(\d{2}):(\d{2})$/.exec(String(v ?? ""));
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes <= 1440 ? minutes : null;
};
const int = (v: FormDataEntryValue | null, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export async function signOut() {
  await endSession();
  redirect("/login");
}

export async function hostCancelBooking(form: FormData) {
  const user = await requireUser();
  try {
    await cancelBooking(String(form.get("id")), { kind: "host", hostId: user.id }, String(form.get("reason") ?? "") || undefined);
  } catch (err) {
    if (!(err instanceof BookingError)) throw err;
  }
  revalidatePath("/dashboard");
}

// ---- Connections ----

export async function disconnectStripe() {
  const user = await requireUser();
  // Paid event types stop taking bookings (invitees see that payments aren't available) until Stripe is reconnected.
  await disconnectAccount(user);
  revalidatePath("/dashboard");
}

export async function updateConnection(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id"));
  const op = String(form.get("op"));
  const mine = and(eq(calendarConnections.id, id), eq(calendarConnections.userId, user.id));
  if (op === "disconnect") {
    await db.delete(calendarConnections).where(mine);
  } else if (op === "toggle-conflicts") {
    const [c] = await db.select().from(calendarConnections).where(mine);
    if (c) await db.update(calendarConnections).set({ checkForConflicts: !c.checkForConflicts }).where(mine);
  } else if (op === "make-write-target") {
    await db.transaction(async (tx) => {
      await tx.update(calendarConnections).set({ isWriteTarget: false }).where(eq(calendarConnections.userId, user.id));
      await tx.update(calendarConnections).set({ isWriteTarget: true }).where(mine);
    });
  }
  revalidatePath("/dashboard");
}

// ---- Availability ----

export async function saveAvailability(form: FormData) {
  const user = await requireUser();
  const [schedule] = await db.select().from(schedules).where(and(eq(schedules.userId, user.id), eq(schedules.isDefault, true)));
  const timeZone = cleanZone(String(form.get("timeZone") ?? schedule.timeZone));
  if (!timeZone) redirect("/dashboard/availability?error=tz");

  const rules: { scheduleId: string; weekday: number; startMinute: number; endMinute: number }[] = [];
  for (let d = 1; d <= 7; d++) {
    if (!form.get(`on-${d}`)) continue;
    const s = hm(form.get(`start-${d}`));
    const e = hm(form.get(`end-${d}`));
    if (s === null || e === null || s >= e) redirect(`/dashboard/availability?error=hours`);
    rules.push({ scheduleId: schedule.id, weekday: d, startMinute: s!, endMinute: e! });
  }
  await db.transaction(async (tx) => {
    await tx.update(schedules).set({ timeZone }).where(eq(schedules.id, schedule.id));
    await tx.update(users).set({ timeZone }).where(eq(users.id, user.id));
    await tx.delete(availabilityRules).where(eq(availabilityRules.scheduleId, schedule.id));
    if (rules.length) await tx.insert(availabilityRules).values(rules);
  });
  redirect("/dashboard/availability?saved=1");
}

export async function addOverride(form: FormData) {
  const user = await requireUser();
  const [schedule] = await db.select().from(schedules).where(and(eq(schedules.userId, user.id), eq(schedules.isDefault, true)));
  const date = String(form.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) redirect("/dashboard/availability?error=date");
  const unavailable = form.get("unavailable") === "on";
  const s = hm(form.get("start"));
  const e = hm(form.get("end"));
  if (!unavailable && (s === null || e === null || s >= e)) redirect("/dashboard/availability?error=hours");
  await db.transaction(async (tx) => {
    await tx.delete(dateOverrides).where(and(eq(dateOverrides.scheduleId, schedule.id), eq(dateOverrides.date, date)));
    await tx.insert(dateOverrides).values({ scheduleId: schedule.id, date, startMinute: unavailable ? null : s, endMinute: unavailable ? null : e });
  });
  redirect("/dashboard/availability?saved=1");
}

export async function removeOverride(form: FormData) {
  const user = await requireUser();
  const [schedule] = await db.select().from(schedules).where(and(eq(schedules.userId, user.id), eq(schedules.isDefault, true)));
  await db.delete(dateOverrides).where(and(eq(dateOverrides.scheduleId, schedule.id), eq(dateOverrides.date, String(form.get("date")))));
  revalidatePath("/dashboard/availability");
}

// ---- Event types ----

const LOCATIONS = ["google_meet", "zoom", "phone", "in_person", "custom"] as const;

export async function saveEventType(form: FormData) {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  const title = String(form.get("title") ?? "").trim().slice(0, 120);
  // Team event types (round-robin) belong to the team the user owns; the choice is made when creating.
  const forTeam = form.get("team") === "1";
  const team = forTeam ? await ownedTeam(user.id) : null;
  const back = (e: string) => redirect(`/dashboard/event-types/${id || "new"}?error=${e}${forTeam && !id ? "&team=1" : ""}`);
  if (forTeam && !team) back("no-team");
  if (!title) back("title");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) back("slug");
  const location = String(form.get("locationKind"));
  const questions = parseQuestions(String(form.get("questions") ?? "[]"));
  if (!questions) back("questions");
  const reminders = parseReminders(String(form.get("reminders") ?? "[]"));
  if (!reminders) back("reminders");
  const redirectUrl = String(form.get("redirectUrl") ?? "").trim() || null;
  const priceInput = String(form.get("price") ?? "").trim();
  const priceCurrency = String(form.get("priceCurrency") ?? "usd");
  const priceAmount = priceInput ? parsePrice(priceInput, priceCurrency) : null;
  if (priceInput && priceAmount === null) back("price");
  // Paid events charge to the account owner (the team owner for team events, who is the one editing here).
  if (priceAmount && !user.stripeChargesEnabled) back("price-account");
  if (redirectUrl && !isHttpsUrl(redirectUrl)) back("redirect");

  const values = {
    slug,
    title,
    description: String(form.get("description") ?? "").trim().slice(0, 2000) || null,
    durationMinutes: int(form.get("durationMinutes"), 5, 720, 30),
    bufferBeforeMinutes: int(form.get("bufferBeforeMinutes"), 0, 240, 0),
    bufferAfterMinutes: int(form.get("bufferAfterMinutes"), 0, 240, 0),
    minimumNoticeMinutes: int(form.get("minimumNoticeHours"), 0, 24 * 60, 4) * 60,
    bookingWindowDays: int(form.get("bookingWindowDays"), 1, 730, 60),
    maxPerDay: form.get("maxPerDay") ? int(form.get("maxPerDay"), 1, 100, 1) : null,
    locationKind: (LOCATIONS as readonly string[]).includes(location) ? (location as (typeof LOCATIONS)[number]) : "google_meet",
    locationValue: String(form.get("locationValue") ?? "").trim().slice(0, 500) || null,
    isActive: form.get("isActive") === "on",
    isHidden: form.get("isHidden") === "on",
    questions: questions!,
    redirectUrl,
    redirectPassDetails: form.get("redirectPassDetails") === "on",
    // Group events (several invitees per slot) are for personal event types only.
    seatsPerSlot: team ? 1 : int(form.get("seatsPerSlot"), 1, 500, 1),
    reminders: reminders!,
    priceAmount,
    priceCurrency: priceAmount ? priceCurrency : null,
    refundOnCancel: form.get("refundOnCancel") === "on",
  };

  // Free plan: no prices or custom reminder wording, and one active personal event type.
  if (!team && !(await hasPaidFeatures(user))) {
    if (priceAmount) back("plan-price");
    if (reminders!.some((r) => r.subject || r.body)) back("plan-reminders");
    if (values.isActive) {
      const active = await db
        .select({ id: eventTypes.id, isActive: eventTypes.isActive })
        .from(eventTypes)
        .where(and(eq(eventTypes.userId, user.id), isNull(eventTypes.teamId), eq(eventTypes.isActive, true)));
      // Turning on a new or switched-off event type while another is already on goes past the Free allowance.
      const alreadyOn = active.some((e) => e.id === id);
      if (!alreadyOn && active.length >= FREE_EVENT_TYPES) back("plan-limit");
    }
  }

  const scope = team ? eq(eventTypes.teamId, team.id) : and(eq(eventTypes.userId, user.id), isNull(eventTypes.teamId));
  const [clash] = await db.select({ id: eventTypes.id }).from(eventTypes).where(and(scope, eq(eventTypes.slug, slug)));
  if (clash && clash.id !== id) back("slug-taken");

  if (!team) {
    if (id) {
      await db.update(eventTypes).set(values).where(and(eq(eventTypes.id, id), scope));
    } else {
      const [schedule] = await db.select().from(schedules).where(and(eq(schedules.userId, user.id), eq(schedules.isDefault, true)));
      await db.insert(eventTypes).values({ ...values, userId: user.id, scheduleId: schedule.id });
    }
    redirect("/dashboard/event-types?saved=1");
  }

  // Team hosts must be current team members.
  const picked = form.getAll("host").map(String);
  const members = picked.length
    ? await db.select({ id: teamMembers.userId }).from(teamMembers).where(and(eq(teamMembers.teamId, team!.id), inArray(teamMembers.userId, picked)))
    : [];
  if (members.length === 0) back("hosts");
  const scheduling = form.get("scheduling") === "collective" ? "collective" : "round_robin";
  await db.transaction(async (tx) => {
    let eventTypeId = id;
    if (id) {
      const [row] = await tx
        .update(eventTypes)
        .set({ ...values, scheduling })
        .where(and(eq(eventTypes.id, id), scope))
        .returning({ id: eventTypes.id });
      if (!row) return;
    } else {
      const [row] = await tx
        .insert(eventTypes)
        .values({ ...values, userId: user.id, teamId: team!.id, scheduling, scheduleId: null })
        .returning({ id: eventTypes.id });
      eventTypeId = row.id;
    }
    await tx.delete(eventTypeHosts).where(eq(eventTypeHosts.eventTypeId, eventTypeId));
    await tx.insert(eventTypeHosts).values(members.map((m) => ({ eventTypeId, userId: m.id })));
  });
  redirect("/dashboard/event-types?saved=1");
}
