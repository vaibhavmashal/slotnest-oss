// "Add to calendar" links for the booking confirmation page: Google Calendar, Outlook and a plain .ics file.
// The invitee also gets an invite by email; these are for calendars that don't pick that up.

export interface CalendarEntry {
  title: string;
  start: string;
  end: string;
  details?: string;
  location?: string;
}

/** 2026-11-09T14:00:00.000Z → 20261109T140000Z */
const compact = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function googleCalendarUrl(e: CalendarEntry): string {
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${compact(e.start)}/${compact(e.end)}` });
  if (e.details) q.set("details", e.details);
  if (e.location) q.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${q}`;
}

export function outlookCalendarUrl(e: CalendarEntry): string {
  const q = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: e.title,
    startdt: new Date(e.start).toISOString(),
    enddt: new Date(e.end).toISOString(),
  });
  if (e.details) q.set("body", e.details);
  if (e.location) q.set("location", e.location);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${q}`;
}

const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** A one-event iCalendar file (METHOD:PUBLISH, so it's simply added, not treated as an invitation). */
export function icsFile(e: CalendarEntry, uid: string, now = new Date()): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Slotnest//Booking//EN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${compact(now.toISOString())}`,
    `DTSTART:${compact(e.start)}`,
    `DTEND:${compact(e.end)}`,
    `SUMMARY:${text(e.title)}`,
    ...(e.details ? [`DESCRIPTION:${text(e.details)}`] : []),
    ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
