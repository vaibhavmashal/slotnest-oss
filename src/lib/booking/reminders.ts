// Reminder workflows: the reminder and follow-up emails an event type sends around each booking.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Reminder } from "@/db/schema";

export const MAX_REMINDERS = 10;
/** Up to 30 days before or after. */
export const MAX_REMINDER_MINUTES = 30 * 24 * 60;

export const DEFAULT_REMINDERS: Reminder[] = [
  { id: "r24h", when: "before", minutes: 1440, to: "invitee" },
  { id: "r1h", when: "before", minutes: 60, to: "invitee" },
];

const ReminderInput = z.object({
  id: z.string().regex(/^[a-z0-9]{1,16}$/).optional(),
  when: z.enum(["before", "after"]),
  minutes: z.number().int().min(5).max(MAX_REMINDER_MINUTES),
  to: z.enum(["invitee", "host"]),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().max(5000).optional(),
});

/** Reminders from the event type editor (a JSON string); null if invalid. Each keeps or gets a stable id. */
export function parseReminders(json: string): Reminder[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json || "[]");
  } catch {
    return null;
  }
  const parsed = z.array(ReminderInput).max(MAX_REMINDERS).safeParse(raw);
  if (!parsed.success) return null;
  const seen = new Set<string>();
  return parsed.data.map((r) => {
    let id = r.id && !seen.has(r.id) ? r.id : randomBytes(4).toString("hex");
    while (seen.has(id)) id = randomBytes(4).toString("hex");
    seen.add(id);
    return { id, when: r.when, minutes: r.minutes, to: r.to, ...(r.subject && { subject: r.subject }), ...(r.body && { body: r.body }) };
  });
}

/** When a reminder goes out for a meeting: `minutes` before its start, or after its end. */
export function reminderTime(r: Reminder, start: Date, end: Date): Date {
  return r.when === "before" ? new Date(start.getTime() - r.minutes * 60_000) : new Date(end.getTime() + r.minutes * 60_000);
}

/** "1 hour", "2 days", "90 minutes". */
export function describeMinutes(minutes: number): string {
  const [n, unit] = minutes % 1440 === 0 ? [minutes / 1440, "day"] : minutes % 60 === 0 ? [minutes / 60, "hour"] : [minutes, "minute"];
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

export const PLACEHOLDERS = ["name", "event", "time", "host", "location", "manage_link", "booking_link"] as const;
export type PlaceholderValues = Record<(typeof PLACEHOLDERS)[number], string>;

/** Replace {{name}}-style placeholders; unknown ones are left as typed. */
export function fill(template: string, values: PlaceholderValues): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (Object.hasOwn(values, k) ? values[k as keyof PlaceholderValues] : m));
}
