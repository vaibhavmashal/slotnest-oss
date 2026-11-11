// Side effects of booking lifecycle events. Each handler is safe to retry: external objects are
// created only when their id isn't stored yet, and reminders check the booking is still current.
// Collective bookings have several hosts: r.host organizes (video link, its calendar event lives on the booking),
// and each extra host gets their own calendar event (stored on their booking_hosts row) and host emails.
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { bookingHosts, bookings, eventTypes, users, type Reminder } from "@/db/schema";
import { config } from "@/lib/config";
import { decrypt } from "@/lib/crypto";
import { answerLines } from "@/lib/booking/questions";
import { DEFAULT_REMINDERS, describeMinutes, fill, reminderTime, type PlaceholderValues } from "@/lib/booking/reminders";
import { buildIcs } from "@/lib/email/ics";
import { sendEmail } from "@/lib/email/send";
import { emailBranding, formatWhen, render } from "@/lib/email/templates";
import { contextBranding, eventContext, hasPaidFeatures, joinNames, publicUrl } from "@/lib/teams";
import { getConnectionById, type Connection } from "@/lib/integrations/connections";
import {
  createCalendarEvent,
  createZoomMeeting,
  deleteCalendarEvent,
  deleteZoomMeeting,
  updateCalendarEvent,
  updateZoomMeeting,
  writeTarget,
  zoomConnection,
  type CalendarEventInput,
} from "@/lib/integrations/calendar";
import { abandonCheckout, formatPrice, refundBooking } from "@/lib/payments";
import { dispatchBookingWebhooks } from "@/lib/webhooks";
import { enqueue, type JobData } from "./queue";

/** Confirmed bookings in a group session, except one. */
async function sessionBookings(key: string, exceptId: string) {
  return db
    .select()
    .from(bookings)
    .where(and(eq(bookings.sessionKey, key), eq(bookings.status, "confirmed"), ne(bookings.id, exceptId)))
    .orderBy(bookings.createdAt);
}

async function load(bookingId: string) {
  const [row] = await db
    .select({ booking: bookings, eventType: eventTypes, host: users })
    .from(bookings)
    .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
    .innerJoin(users, eq(users.id, bookings.hostId))
    .where(eq(bookings.id, bookingId));
  if (!row) throw new Error(`Booking ${bookingId} not found`);
  // Team event types carry the team's branding; r.host is the assigned member (or collective organizer).
  const context = await eventContext(row.eventType, row.host);
  const extra = await db
    .select({ host: users, link: bookingHosts })
    .from(bookingHosts)
    .innerJoin(users, eq(users.id, bookingHosts.hostId))
    .where(and(eq(bookingHosts.bookingId, bookingId), ne(bookingHosts.hostId, row.host.id)))
    .orderBy(users.name);
  const names = joinNames([row.host.name, ...extra.map((e) => e.host.name)]);
  // Group events: the other confirmed invitees in this booking's session (they share one calendar event).
  const mates = row.booking.sessionKey ? await sessionBookings(row.booking.sessionKey, bookingId) : [];
  return { ...row, context, extra, names, mates, brand: emailBranding(await contextBranding(context)) };
}
type Row = Awaited<ReturnType<typeof load>>;
type Host = Row["host"];

/** Every host of the meeting, organizer first. */
const allHosts = (r: Row): Host[] => [r.host, ...r.extra.map((e) => e.host)];

const manageUrl = (r: Row) =>
  r.booking.manageTokenEnc ? `${config.appUrl}/b/${r.booking.id}?t=${decrypt(r.booking.manageTokenEnc)}` : undefined;

function locationText(r: Row): string | undefined {
  if (r.booking.meetingUrl) return r.booking.meetingUrl;
  switch (r.eventType.locationKind) {
    case "phone":
      return r.eventType.locationValue ? `Phone: ${r.eventType.locationValue}` : "Phone call (the host will call you)";
    case "in_person":
    case "custom":
      return r.eventType.locationValue ?? undefined;
    default:
      return undefined; // video link not available (provider not connected)
  }
}

function calendarInput(r: Row, addGoogleMeet: boolean): CalendarEventInput {
  if (r.booking.sessionKey) return groupCalendarInput(r, [...(r.booking.status === "confirmed" ? [r.booking] : []), ...r.mates], addGoogleMeet);
  const lines = [
    `Booked by ${r.booking.inviteeName} <${r.booking.inviteeEmail}>`,
    `Invitee time zone: ${r.booking.inviteeTimeZone}`,
    ...(r.booking.answers.length ? ["", ...answerLines(r.booking.answers)] : []),
    ...(r.booking.notes ? ["", `Notes: ${r.booking.notes}`] : []),
    ...(r.booking.meetingUrl ? ["", `Join: ${r.booking.meetingUrl}`] : []),
  ];
  return {
    summary: `${r.eventType.title}: ${r.booking.inviteeName}`,
    description: lines.join("\n"),
    start: r.booking.startAt,
    end: r.booking.endAt,
    location: locationText(r),
    addGoogleMeet,
    requestId: r.booking.id,
  };
}

/** One calendar event for a whole group session, listing everyone booked into it. */
function groupCalendarInput(r: Row, attendees: Row["booking"][], addGoogleMeet: boolean): CalendarEventInput {
  const lines = [
    `${attendees.length} of ${r.eventType.seatsPerSlot} seats booked:`,
    ...attendees.map((b) => `- ${b.inviteeName} <${b.inviteeEmail}>${b.answers.length ? ` (${answerLines(b.answers).join("; ")})` : ""}`),
    ...(r.booking.meetingUrl ? ["", `Join: ${r.booking.meetingUrl}`] : []),
  ];
  return {
    summary: `${r.eventType.title} (${attendees.length}/${r.eventType.seatsPerSlot})`,
    description: lines.join("\n"),
    start: r.booking.startAt,
    end: r.booking.endAt,
    location: locationText(r),
    addGoogleMeet,
    requestId: r.booking.id,
  };
}

function ics(r: Row, method: "REQUEST" | "CANCEL") {
  return {
    method,
    content: buildIcs({
      method,
      uid: r.booking.icalUid,
      sequence: r.booking.icalSequence,
      start: r.booking.startAt,
      end: r.booking.endAt,
      summary: `${r.eventType.title} with ${r.names}`,
      description: [r.eventType.description, locationText(r) && `Where: ${locationText(r)}`, manageUrl(r) && `Reschedule or cancel: ${manageUrl(r)}`]
        .filter(Boolean)
        .join("\n\n"),
      location: locationText(r),
      url: manageUrl(r),
      organizer: { name: r.host.name, email: r.host.email },
      attendees: [{ name: r.booking.inviteeName, email: r.booking.inviteeEmail }],
    }),
  };
}

/** Queue the event type's reminder and follow-up emails for this booking (those still in the future). */
async function scheduleReminders(r: Row) {
  const startAt = r.booking.startAt.toISOString();
  for (const rem of r.eventType.reminders) {
    const at = reminderTime(rem, r.booking.startAt, r.booking.endAt);
    if (at.getTime() <= Date.now()) continue;
    await enqueue(
      "booking-reminder",
      { bookingId: r.booking.id, startAt, reminderId: rem.id },
      { startAfter: at, singletonKey: `${r.booking.id}:${rem.id}:${startAt}` },
    );
  }
}

async function hasCalendar(host: Host) {
  return (await writeTarget(host.id)) !== null;
}

/** Collective: put the meeting on each extra host's own calendar (after the organizer's, so the join link is known). */
async function createExtraEvents(r: Row) {
  for (const { host, link } of r.extra) {
    if (link.externalEventId) continue;
    const target = await writeTarget(host.id);
    if (!target) continue;
    const ev = await createCalendarEvent(target, { ...calendarInput(r, false), requestId: `${r.booking.id}:${host.id}` });
    await db
      .update(bookingHosts)
      .set({ externalEventId: ev.id, externalConnectionId: target.id })
      .where(and(eq(bookingHosts.bookingId, r.booking.id), eq(bookingHosts.hostId, host.id)));
  }
}

async function forEachExtraEvent(r: Row, fn: (c: Connection, eventId: string) => Promise<void>) {
  for (const { link } of r.extra) {
    if (!link.externalEventId || !link.externalConnectionId) continue;
    const cal = await getConnectionById(link.externalConnectionId);
    if (cal) await fn(cal, link.externalEventId);
  }
}

/** The host notification, to every host; an .ics is attached for hosts without a connected calendar. */
async function emailHosts(r: Row, subject: string, heading: string, lines: (host: Host) => string[], method: "REQUEST" | "CANCEL", withLink = false) {
  for (const host of allHosts(r)) {
    await sendEmail({
      to: host.email,
      subject,
      ...((await hasCalendar(host)) ? {} : { ics: ics(r, method) }),
      ...render({ heading, lines: lines(host), ...(withLink && { link: { label: "Open dashboard", url: `${config.appUrl}/dashboard` } }) }),
    });
  }
}

const withOthers = (r: Row, host: Host) => {
  const others = allHosts(r).filter((h) => h.id !== host.id).map((h) => h.name);
  return others.length ? [`With ${joinNames(others)}.`] : [];
};

/** Create the Zoom meeting and the host's calendar event for a booking, where they don't exist yet. */
async function createMeeting(r: Row): Promise<Row> {
  const bookingId = r.booking.id;
  // 1. Zoom meeting (if this event type uses Zoom and the host connected it).
  if (r.eventType.locationKind === "zoom" && !r.booking.videoMeetingId) {
    const zoom = await zoomConnection(r.host.id);
    if (zoom) {
      const m = await createZoomMeeting(zoom, r.booking.sessionKey ? r.eventType.title : `${r.eventType.title}: ${r.booking.inviteeName}`, r.booking.startAt, r.eventType.durationMinutes);
      await db.update(bookings).set({ meetingUrl: m.joinUrl, videoMeetingId: m.id, videoConnectionId: zoom.id }).where(eq(bookings.id, bookingId));
      r = await load(bookingId);
    }
  }

  // 2. Event on the host's calendar (Google Meet links are created together with the Google event).
  if (!r.booking.externalEventId) {
    const target = await writeTarget(r.host.id);
    if (target) {
      const wantMeet = r.eventType.locationKind === "google_meet" && target.provider === "google";
      const ev = await createCalendarEvent(target, calendarInput(r, wantMeet));
      await db
        .update(bookings)
        .set({ externalEventId: ev.id, externalConnectionId: target.id, ...(ev.meetUrl && { meetingUrl: ev.meetUrl }) })
        .where(eq(bookings.id, bookingId));
      r = await load(bookingId);
    }
  }
  return r;
}

/** Copy a session's shared meeting (calendar event and video link) onto one of its bookings. */
async function adopt(bookingId: string, from: Row["booking"]) {
  await db
    .update(bookings)
    .set({
      meetingUrl: from.meetingUrl,
      externalEventId: from.externalEventId,
      externalConnectionId: from.externalConnectionId,
      videoMeetingId: from.videoMeetingId,
      videoConnectionId: from.videoConnectionId,
    })
    .where(eq(bookings.id, bookingId));
}

/** Serialize work on one group session, so two invitees booking at once don't each create a meeting. */
async function withSessionLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`session:${key}`}))`);
    return fn();
  });
}

/** Group events: join the session's existing meeting (and list this invitee on it), or create it if first. */
async function joinSession(r: Row): Promise<Row> {
  return withSessionLock(r.booking.sessionKey!, async () => {
    r = await load(r.booking.id);
    if (r.booking.externalEventId || r.booking.videoMeetingId) return r;
    const source = r.mates.find((m) => m.externalEventId || m.videoMeetingId);
    if (!source) return createMeeting(r);
    await adopt(r.booking.id, source);
    r = await load(r.booking.id);
    await refreshSessionEvent(r);
    return r;
  });
}

/** Rewrite a session's shared calendar event with its current attendee list. */
async function refreshSessionEvent(r: Row) {
  if (!r.booking.externalEventId || !r.booking.externalConnectionId) return;
  const cal = await getConnectionById(r.booking.externalConnectionId);
  if (cal) await updateCalendarEvent(cal, r.booking.externalEventId, calendarInput(r, false));
}

/** True if a confirmed booking in `others` uses this booking's calendar event or video meeting. */
const sharesMeeting = (b: Row["booking"], others: Row["booking"][]) =>
  others.some(
    (m) => (b.externalEventId && m.externalEventId === b.externalEventId) || (b.videoMeetingId && m.videoMeetingId === b.videoMeetingId),
  );

// ---------------------------------------------------------------------------------------------

export async function onConfirmed({ bookingId }: JobData["booking-confirmed"]) {
  let r = await load(bookingId);
  if (r.booking.status !== "confirmed" || r.booking.paymentStatus === "pending" || r.booking.paymentStatus === "expired") return;

  // 1–2. Video link and calendar event (group events: shared with the session, see joinSession).
  r = r.booking.sessionKey ? await joinSession(r) : await createMeeting(r);
  await createExtraEvents(r);

  // 3. Emails: invitee gets the .ics invite; hosts get one too unless the event is already on their calendar.
  const when = formatWhen(r.booking.startAt, r.booking.endAt, r.booking.inviteeTimeZone);
  const where = locationText(r);
  await sendEmail({
    to: r.booking.inviteeEmail,
    subject: `Confirmed: ${r.eventType.title} with ${r.names}`,
    ics: ics(r, "REQUEST"),
    ...render({
      branding: r.brand,
      heading: "Your meeting is booked",
      lines: [
        `${r.eventType.title} with ${r.names}`,
        when,
        ...(where ? [`Where: ${where}`] : []),
        ...(r.booking.paymentStatus === "paid" ? [`Paid: ${formatPrice(r.booking.paymentAmount!, r.booking.paymentCurrency!)}`] : []),
        "A calendar invite is attached.",
      ],
      ...(manageUrl(r) && { link: { label: "Reschedule or cancel", url: manageUrl(r)! } }),
    }),
  });
  await emailHosts(
    r,
    `New booking: ${r.eventType.title} with ${r.booking.inviteeName}`,
    "New booking",
    (host) => [
      `${r.booking.inviteeName} <${r.booking.inviteeEmail}> booked ${r.eventType.title}.`,
      formatWhen(r.booking.startAt, r.booking.endAt, host.timeZone),
      ...withOthers(r, host),
      ...(where ? [`Where: ${where}`] : []),
      ...answerLines(r.booking.answers),
      ...(r.booking.notes ? [`Notes: ${r.booking.notes}`] : []),
      ...(r.booking.paymentStatus === "paid" ? [`Paid: ${formatPrice(r.booking.paymentAmount!, r.booking.paymentCurrency!)} (to your Stripe account)`] : []),
    ],
    "REQUEST",
    true,
  );

  await scheduleReminders(r);
  // Last, so the payload includes the meeting link created above.
  await dispatchBookingWebhooks(bookingId, "booking.created");
}

export async function onRescheduled({ bookingId, previousStart }: JobData["booking-rescheduled"]) {
  let r = await load(bookingId);
  if (r.booking.status !== "confirmed") return;

  if (r.booking.sessionKey) {
    r = await moveSession(r, previousStart);
  } else if (r.booking.videoMeetingId && r.booking.videoConnectionId) {
    const zoom = await getConnectionById(r.booking.videoConnectionId);
    if (zoom) await updateZoomMeeting(zoom, r.booking.videoMeetingId, r.booking.startAt, r.eventType.durationMinutes);
  }
  if (!r.booking.sessionKey && r.booking.externalEventId && r.booking.externalConnectionId) {
    const cal = await getConnectionById(r.booking.externalConnectionId);
    if (cal) await updateCalendarEvent(cal, r.booking.externalEventId, calendarInput(r, false));
  }
  await forEachExtraEvent(r, (cal, id) => updateCalendarEvent(cal, id, calendarInput(r, false)));

  const was = formatWhen(new Date(previousStart), new Date(new Date(previousStart).getTime() + r.eventType.durationMinutes * 60_000), r.booking.inviteeTimeZone);
  const now = formatWhen(r.booking.startAt, r.booking.endAt, r.booking.inviteeTimeZone);
  await sendEmail({
    to: r.booking.inviteeEmail,
    subject: `Updated: ${r.eventType.title} with ${r.names}`,
    ics: ics(r, "REQUEST"),
    ...render({
      branding: r.brand,
      heading: "Your meeting has a new time",
      lines: [`${r.eventType.title} with ${r.names}`, `New time: ${now}`, `Previously: ${was}`],
      ...(manageUrl(r) && { link: { label: "Reschedule or cancel", url: manageUrl(r)! } }),
    }),
  });
  await emailHosts(
    r,
    `Rescheduled: ${r.eventType.title} with ${r.booking.inviteeName}`,
    "Booking rescheduled",
    (host) => [
      `${r.booking.inviteeName} <${r.booking.inviteeEmail}>`,
      `New time: ${formatWhen(r.booking.startAt, r.booking.endAt, host.timeZone)}`,
      ...withOthers(r, host),
    ],
    "REQUEST",
  );
  await scheduleReminders(r);
  await dispatchBookingWebhooks(bookingId, "booking.rescheduled", previousStart);
}

export async function onCancelled({ bookingId, by }: JobData["booking-cancelled"]) {
  let r = await load(bookingId);

  // Cancelled before paying: just release the hold. Nothing was confirmed, so there's nobody to tell.
  if (r.booking.paymentStatus === "pending" || r.booking.paymentStatus === "expired") {
    await abandonCheckout(bookingId); // paid at the last moment? then it's refunded there
    return;
  }
  const refunding = r.booking.paymentStatus === "paid" && r.eventType.refundOnCancel;
  if (refunding) await refundBooking(r.booking);
  const refundLine =
    r.booking.paymentStatus === "paid" || refunding
      ? [refunding ? `Your payment of ${formatPrice(r.booking.paymentAmount!, r.booking.paymentCurrency!)} is being refunded to your card.` : "Contact the host about your payment."]
      : [];

  if (r.booking.sessionKey) {
    // Group events: the meeting stays for the others in the session; it's removed with the last invitee.
    await withSessionLock(r.booking.sessionKey, async () => {
      r = await load(bookingId);
      if (sharesMeeting(r.booking, r.mates)) await refreshSessionEvent(r);
      else await deleteMeeting(r);
    });
  } else {
    await deleteMeeting(r);
  }
  await forEachExtraEvent(r, (cal, id) => deleteCalendarEvent(cal, id));

  const reason = r.booking.cancelReason ? [`Reason: ${r.booking.cancelReason}`] : [];
  await sendEmail({
    to: r.booking.inviteeEmail,
    subject: `Cancelled: ${r.eventType.title} with ${r.names}`,
    ics: ics(r, "CANCEL"),
    ...render({
      branding: r.brand,
      heading: "Your meeting was cancelled",
      lines: [
        `${r.eventType.title} with ${r.names}`,
        formatWhen(r.booking.startAt, r.booking.endAt, r.booking.inviteeTimeZone),
        by === "host" ? `${r.extra.length ? "Your hosts" : r.host.name} cancelled this meeting.` : "You cancelled this meeting.",
        ...reason,
        ...refundLine,
      ],
      link: { label: "Book a new time", url: publicUrl(r.context, r.eventType) },
    }),
  });
  await emailHosts(
    r,
    `Cancelled: ${r.eventType.title} with ${r.booking.inviteeName}`,
    "Booking cancelled",
    (host) => [
      `${r.booking.inviteeName} <${r.booking.inviteeEmail}>`,
      formatWhen(r.booking.startAt, r.booking.endAt, host.timeZone),
      ...withOthers(r, host),
      by === "host" ? (r.extra.length ? "A host cancelled this meeting." : "You cancelled this meeting.") : "The invitee cancelled this meeting.",
      ...reason,
    ],
    "CANCEL",
  );
  await dispatchBookingWebhooks(bookingId, "booking.cancelled");
}

/** Delete a booking's video meeting and host calendar event. */
async function deleteMeeting(r: Row) {
  if (r.booking.videoMeetingId && r.booking.videoConnectionId) {
    const zoom = await getConnectionById(r.booking.videoConnectionId);
    if (zoom) await deleteZoomMeeting(zoom, r.booking.videoMeetingId);
  }
  if (r.booking.externalEventId && r.booking.externalConnectionId) {
    const cal = await getConnectionById(r.booking.externalConnectionId);
    if (cal) await deleteCalendarEvent(cal, r.booking.externalEventId);
  }
}

/**
 * Group events: a rescheduled invitee leaves their old session and joins (or starts) the one at the new time.
 * The old meeting stays if others are still in it. If not, it moves with this invitee when nobody is at the new
 * time yet, or is deleted when they join a session that already has a meeting.
 */
async function moveSession(r: Row, previousStart: string): Promise<Row> {
  const oldKey = `${r.eventType.id}:${new Date(previousStart).toISOString()}`;
  const oldMates = await sessionBookings(oldKey, r.booking.id);
  const sharedOld = sharesMeeting(r.booking, oldMates);
  return withSessionLock(r.booking.sessionKey!, async () => {
    r = await load(r.booking.id);
    const source = r.mates.find((m) => m.externalEventId || m.videoMeetingId);
    if (!sharedOld && !source) {
      // Nobody else at either time: move this invitee's own meeting to the new time.
      if (r.booking.videoMeetingId && r.booking.videoConnectionId) {
        const zoom = await getConnectionById(r.booking.videoConnectionId);
        if (zoom) await updateZoomMeeting(zoom, r.booking.videoMeetingId, r.booking.startAt, r.eventType.durationMinutes);
      }
      await refreshSessionEvent(r);
      return r;
    }
    if (sharedOld) await refreshSessionEvent(await load(oldMates[0].id)); // drop this invitee from the old list
    else await deleteMeeting(r); // their own meeting had nobody else, and the new session already has one
    await db
      .update(bookings)
      .set({ meetingUrl: null, externalEventId: null, externalConnectionId: null, videoMeetingId: null, videoConnectionId: null })
      .where(eq(bookings.id, r.booking.id));
    if (!source) return createMeeting(await load(r.booking.id));
    await adopt(r.booking.id, source);
    r = await load(r.booking.id);
    await refreshSessionEvent(r);
    return r;
  });
}

export async function onReminder({ bookingId, startAt, kind, reminderId }: JobData["booking-reminder"]) {
  const r = await load(bookingId);
  // Stale reminders (booking cancelled or moved since scheduling) are dropped.
  if (r.booking.status !== "confirmed" || r.booking.startAt.toISOString() !== startAt) return;
  // Jobs queued before reminder workflows carry `kind`; they map to the two default reminders.
  const found = reminderId
    ? r.eventType.reminders.find((x) => x.id === reminderId)
    : DEFAULT_REMINDERS.find((x) => x.minutes === (kind === "1h" ? 60 : 1440));
  if (!found) return; // removed from the event type since this booking was made
  // Custom wording is a paid feature: on the Free plan the standard reminder goes out instead.
  const rem: Reminder = (await hasPaidFeatures(r.context.account)) ? found : { ...found, subject: undefined, body: undefined };

  const values = (timeZone: string): PlaceholderValues => ({
    name: r.booking.inviteeName,
    event: r.eventType.title,
    time: formatWhen(r.booking.startAt, r.booking.endAt, timeZone),
    host: r.names,
    location: locationText(r) ?? "",
    manage_link: manageUrl(r) ?? "",
    booking_link: publicUrl(r.context, r.eventType),
  });

  if (rem.to === "invitee") {
    const v = values(r.booking.inviteeTimeZone);
    const builtIn = builtInInviteeReminder(r, rem, v);
    const link =
      rem.when === "after" ? { label: "Book again", url: v.booking_link } : manageUrl(r) ? { label: "Reschedule or cancel", url: manageUrl(r)! } : undefined;
    await sendEmail({
      to: r.booking.inviteeEmail,
      subject: rem.subject ? fill(rem.subject, v) : builtIn.subject,
      ...render({
        branding: r.brand,
        heading: rem.subject ? fill(rem.subject, v) : builtIn.heading,
        lines: rem.body ? fill(rem.body, v).split("\n") : builtIn.lines,
        ...(link && { link }),
      }),
    });
    return;
  }
  for (const host of allHosts(r)) {
    const v = values(host.timeZone);
    const subject = rem.subject
      ? fill(rem.subject, v)
      : rem.when === "before"
        ? `Coming up in ${describeMinutes(rem.minutes)}: ${r.eventType.title} with ${r.booking.inviteeName}`
        : `Follow up: ${r.eventType.title} with ${r.booking.inviteeName}`;
    await sendEmail({
      to: host.email,
      subject,
      ...render({
        heading: subject,
        lines: rem.body
          ? fill(rem.body, v).split("\n")
          : [`${r.booking.inviteeName} <${r.booking.inviteeEmail}>`, v.time, ...(v.location ? [`Where: ${v.location}`] : []), ...answerLines(r.booking.answers)],
        link: { label: "Open dashboard", url: `${config.appUrl}/dashboard` },
      }),
    });
  }
}

/** Slotnest's own wording for a reminder or follow-up to the invitee. */
function builtInInviteeReminder(r: Row, rem: Reminder, v: PlaceholderValues) {
  if (rem.when === "after") {
    return {
      subject: `Thanks for meeting: ${r.eventType.title} with ${r.names}`,
      heading: "Thanks for your time",
      lines: [`Thanks for meeting with ${r.names}.`, "If you'd like to talk again, you can book another time below."],
    };
  }
  const soon = rem.minutes === 1440 ? "tomorrow" : `in ${describeMinutes(rem.minutes)}`;
  return {
    subject: `Reminder: ${r.eventType.title} with ${r.names} ${soon}`,
    heading: rem.minutes === 1440 ? "Coming up tomorrow" : `Starting in ${describeMinutes(rem.minutes)}`,
    lines: [`${r.eventType.title} with ${r.names}`, v.time, ...(v.location ? [`Where: ${v.location}`] : [])],
  };
}
