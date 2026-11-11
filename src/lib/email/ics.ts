// RFC 5545 iCalendar generation for meeting invites (iTIP METHOD:REQUEST / METHOD:CANCEL).
// Compatibility notes:
// - UID stays the same for the life of a booking; SEQUENCE increases on every update or cancel,
//   which is what makes Gmail, Outlook and Apple Calendar update the existing event instead of adding a new one.
// - Times are written in UTC (…Z), which every client accepts without needing a VTIMEZONE block.
// - Lines are CRLF-terminated and folded at 75 octets (UTF-8-safe).

export interface IcsPerson {
  name: string;
  email: string;
}

export interface IcsEvent {
  method: "REQUEST" | "CANCEL";
  uid: string;
  sequence: number;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  organizer: IcsPerson;
  attendees: IcsPerson[];
  /** Defaults to now; injectable for tests. */
  stamp?: Date;
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

// CN is a parameter value: quote it, and strip characters that can't appear inside quotes.
const cn = (name: string) => `"${name.replace(/["\r\n]/g, "")}"`;

/** Fold a content line to at most 75 octets per physical line, never splitting a UTF-8 character. */
export function foldLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const len = Buffer.byteLength(ch, "utf8");
    if (bytes + len > limit) {
      out.push(current);
      current = " ";
      bytes = 1;
      limit = 75;
    }
    current += ch;
    bytes += len;
  }
  out.push(current);
  return out.join("\r\n");
}

export function buildIcs(e: IcsEvent): string {
  const cancel = e.method === "CANCEL";
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Slotnest//Bookings//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${e.method}`,
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${utc(e.stamp ?? new Date())}`,
    `DTSTART:${utc(e.start)}`,
    `DTEND:${utc(e.end)}`,
    `SUMMARY:${escapeText(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${escapeText(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${escapeText(e.location)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    `ORGANIZER;CN=${cn(e.organizer.name)}:mailto:${e.organizer.email}`,
    ...e.attendees.map(
      (a) => `ATTENDEE;CN=${cn(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${a.email}`,
    ),
    `STATUS:${cancel ? "CANCELLED" : "CONFIRMED"}`,
    "TRANSP:OPAQUE",
    ...(cancel
      ? []
      : ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Reminder", "TRIGGER:-PT15M", "END:VALARM"]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
