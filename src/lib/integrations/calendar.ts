// Calendar and video provider calls: free/busy reads, event writes, and meeting links.
import { DateTime } from "luxon";
import { accessToken, listConnections, recordError, type Connection } from "./connections";

export interface Busy {
  start: string;
  end: string;
}

const CHUNK_DAYS = 30; // both providers limit the free/busy range per request

async function api(c: Connection, url: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(c);
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    const err = new Error(`${c.provider} ${init.method ?? "GET"} ${new URL(url).pathname}: ${res.status} ${(await res.text()).slice(0, 300)}`);
    await recordError(c.id, err);
    throw err;
  }
  return res;
}

function chunks(fromIso: string, toIso: string): [string, string][] {
  const out: [string, string][] = [];
  let a = DateTime.fromISO(fromIso, { zone: "utc" });
  const end = DateTime.fromISO(toIso, { zone: "utc" });
  while (a < end) {
    const b = DateTime.min(a.plus({ days: CHUNK_DAYS }), end);
    out.push([a.toISO()!, b.toISO()!]);
    a = b;
  }
  return out;
}

async function googleBusy(c: Connection, from: string, to: string): Promise<Busy[]> {
  const res = await api(c, "https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: from, timeMax: to, items: [{ id: c.calendarId }] }),
  });
  const json = (await res.json()) as any;
  const cal = json.calendars?.[c.calendarId];
  if (cal?.errors?.length) throw new Error(`google freeBusy: ${JSON.stringify(cal.errors)}`);
  return (cal?.busy ?? []).map((b: any) => ({ start: b.start, end: b.end }));
}

async function microsoftBusy(c: Connection, from: string, to: string): Promise<Busy[]> {
  const graphTime = (iso: string) => ({ dateTime: DateTime.fromISO(iso, { zone: "utc" }).toFormat("yyyy-LL-dd'T'HH:mm:ss"), timeZone: "UTC" });
  const res = await api(c, "https://graph.microsoft.com/v1.0/me/calendar/getSchedule", {
    method: "POST",
    headers: { Prefer: 'outlook.timezone="UTC"' },
    body: JSON.stringify({ schedules: [c.accountEmail], startTime: graphTime(from), endTime: graphTime(to), availabilityViewInterval: 15 }),
  });
  const json = (await res.json()) as any;
  const items = json.value?.[0]?.scheduleItems ?? [];
  return items
    .filter((i: any) => i.status !== "free" && i.status !== "workingElsewhere")
    .map((i: any) => ({
      start: DateTime.fromISO(i.start.dateTime, { zone: "utc" }).toISO()!,
      end: DateTime.fromISO(i.end.dateTime, { zone: "utc" }).toISO()!,
    }));
}

/**
 * Busy times across every calendar the host has marked "check for conflicts".
 * A failing connection is logged on the connection (shown in the dashboard) and skipped, so one broken
 * calendar doesn't take the booking page down; bookings made here are still protected by the database.
 */
export async function getExternalBusy(hostId: string, fromIso: string, toIso: string): Promise<Busy[]> {
  const conns = (await listConnections(hostId)).filter((c) => c.checkForConflicts && c.provider !== "zoom");
  const results = await Promise.all(
    conns.flatMap((c) =>
      chunks(fromIso, toIso).map(async ([a, b]) => {
        try {
          return c.provider === "google" ? await googleBusy(c, a, b) : await microsoftBusy(c, a, b);
        } catch (err) {
          console.error(`[calendar] busy lookup failed for ${c.provider}:${c.accountEmail}`, err);
          return [];
        }
      }),
    ),
  );
  return results.flat();
}

// ---------------------------------------------------------------------------------------------
// Event writes. Invitees are NOT added as attendees on the host's calendar event: they receive our
// own .ics invite, and adding them here would make Google/Microsoft send a second, conflicting invite.

export interface CalendarEventInput {
  summary: string;
  description: string;
  start: Date;
  end: Date;
  location?: string;
  /** Ask Google to attach a Meet link (Google connections only). */
  addGoogleMeet?: boolean;
  requestId: string;
}

export interface WrittenEvent {
  id: string;
  meetUrl?: string;
}

export async function writeTarget(hostId: string): Promise<Connection | null> {
  return (await listConnections(hostId)).find((c) => c.isWriteTarget && c.provider !== "zoom") ?? null;
}

function googleBody(e: CalendarEventInput) {
  return {
    summary: e.summary,
    description: e.description,
    location: e.location,
    start: { dateTime: e.start.toISOString() },
    end: { dateTime: e.end.toISOString() },
    ...(e.addGoogleMeet && { conferenceData: { createRequest: { requestId: e.requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } } }),
  };
}

function microsoftBody(e: CalendarEventInput) {
  const t = (d: Date) => ({ dateTime: d.toISOString().replace("Z", ""), timeZone: "UTC" });
  return {
    subject: e.summary,
    body: { contentType: "text", content: e.description },
    start: t(e.start),
    end: t(e.end),
    ...(e.location && { location: { displayName: e.location } }),
    transactionId: e.requestId, // makes retries idempotent
  };
}

const googleEventsUrl = (c: Connection) => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.calendarId)}/events`;

export async function createCalendarEvent(c: Connection, e: CalendarEventInput): Promise<WrittenEvent> {
  if (c.provider === "google") {
    const res = await api(c, `${googleEventsUrl(c)}?conferenceDataVersion=1&sendUpdates=none`, { method: "POST", body: JSON.stringify(googleBody(e)) });
    let ev = (await res.json()) as any;
    // Meet creation can be asynchronous; poll briefly for the link.
    for (let i = 0; i < 3 && e.addGoogleMeet && !ev.hangoutLink && ev.conferenceData?.createRequest?.status?.statusCode === "pending"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      ev = await (await api(c, `${googleEventsUrl(c)}/${ev.id}`)).json();
    }
    return { id: ev.id, meetUrl: ev.hangoutLink };
  }
  const res = await api(c, "https://graph.microsoft.com/v1.0/me/events", { method: "POST", body: JSON.stringify(microsoftBody(e)) });
  return { id: ((await res.json()) as any).id };
}

export async function updateCalendarEvent(c: Connection, id: string, e: CalendarEventInput): Promise<void> {
  if (c.provider === "google") {
    const { conferenceData: _keepExistingMeet, ...body } = googleBody(e) as any;
    await api(c, `${googleEventsUrl(c)}/${encodeURIComponent(id)}?sendUpdates=none`, { method: "PATCH", body: JSON.stringify(body) });
    return;
  }
  const { transactionId: _, ...body } = microsoftBody(e);
  await api(c, `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
}

export async function deleteCalendarEvent(c: Connection, id: string): Promise<void> {
  const url =
    c.provider === "google"
      ? `${googleEventsUrl(c)}/${encodeURIComponent(id)}?sendUpdates=none`
      : `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(id)}`;
  await api(c, url, { method: "DELETE" });
}

// ---------------------------------------------------------------------------------------------
// Zoom meetings.

export async function zoomConnection(hostId: string): Promise<Connection | null> {
  return (await listConnections(hostId)).find((c) => c.provider === "zoom") ?? null;
}

export async function createZoomMeeting(c: Connection, topic: string, start: Date, durationMinutes: number) {
  const res = await api(c, "https://api.zoom.us/v2/users/me/meetings", {
    method: "POST",
    body: JSON.stringify({
      topic,
      type: 2, // scheduled
      start_time: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
      duration: durationMinutes,
      timezone: "UTC",
      settings: { join_before_host: true, waiting_room: false },
    }),
  });
  const m = (await res.json()) as any;
  return { id: String(m.id), joinUrl: String(m.join_url) };
}

export async function updateZoomMeeting(c: Connection, id: string, start: Date, durationMinutes: number) {
  await api(c, `https://api.zoom.us/v2/meetings/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ start_time: start.toISOString().replace(/\.\d{3}Z$/, "Z"), duration: durationMinutes, timezone: "UTC" }),
  });
}

export async function deleteZoomMeeting(c: Connection, id: string) {
  await api(c, `https://api.zoom.us/v2/meetings/${encodeURIComponent(id)}`, { method: "DELETE" });
}
