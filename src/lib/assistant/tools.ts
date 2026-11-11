// The assistant's tools. Lookups run straight away; changes (cancelling a meeting, creating an event type) are only
// proposed: the user sees a Confirm button, and confirmAction in ./index carries them out.
import type Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import { z } from "zod";
import { and, asc, eq, gte, ilike, inArray, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/db/client";
import { availabilityRules, bookingHosts, bookings, dateOverrides, eventTypes, schedules, users, type AssistantAction } from "@/db/schema";
import { getSlots } from "@/lib/booking/service";
import { config } from "@/lib/config";
import { formatPrice } from "@/lib/payments/currencies";
import { bookingLink, routableEventTypes } from "@/lib/routing";

type User = typeof users.$inferSelect;

/** Thrown for bad tool input; the message goes back to the model as an error result. */
export class ToolError extends Error {}

const DATE = { type: "string", description: "A date, YYYY-MM-DD, in the user's time zone" } as const;
const LOCATIONS = ["google_meet", "zoom", "phone", "in_person", "custom"] as const;

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_event_types",
    description:
      "List the user's event types (the kinds of meeting people can book, such as a 30-minute intro call), including team event types they own. Returns ids, durations, booking links and whether each is on.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_meetings",
    description:
      "List the user's booked meetings in a date range (default: today through the next 14 days), oldest first, at most 50. Use past dates to look back. Optionally filter by invitee name, email or event type title.",
    input_schema: {
      type: "object",
      properties: {
        from_date: DATE,
        to_date: { ...DATE, description: "Last day to include, YYYY-MM-DD (inclusive)" },
        search: { type: "string", description: "Part of an invitee's name or email, or an event type title" },
        include_cancelled: { type: "boolean", description: "Also list cancelled meetings" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "find_open_times",
    description:
      "Find the times people can currently book for one event type, between two dates (at most 14 days apart). This already accounts for the user's availability, calendar conflicts, buffers and notice period.",
    input_schema: {
      type: "object",
      properties: { event_type_id: { type: "string" }, from_date: DATE, to_date: { ...DATE, description: "Last day to include (inclusive)" } },
      required: ["event_type_id", "from_date", "to_date"],
      additionalProperties: false,
    },
  },
  {
    name: "get_availability",
    description: "Get the user's weekly working hours (their default schedule) and any date-specific changes in the next 60 days.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_booking_link",
    description:
      "Get the booking link for an event type to share with someone. Pass their name and email to have them filled in when they open it.",
    input_schema: {
      type: "object",
      properties: { event_type_id: { type: "string" }, name: { type: "string" }, email: { type: "string" } },
      required: ["event_type_id"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_cancel_meeting",
    description:
      "Propose cancelling one of the user's upcoming meetings. Nothing is cancelled yet: the user is shown a Confirm button. When confirmed, the invitee is emailed and paid bookings are refunded if the event type refunds on cancel.",
    input_schema: {
      type: "object",
      properties: {
        booking_id: { type: "string", description: "The meeting id from list_meetings" },
        reason: { type: "string", description: "Optional reason shown to the invitee" },
      },
      required: ["booking_id"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_create_event_type",
    description:
      "Propose a new personal event type. Nothing is created yet: the user is shown a Confirm button. It uses their default availability; they can fine-tune it on the Event types page afterwards.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        duration_minutes: { type: "integer", minimum: 5, maximum: 720 },
        description: { type: "string" },
        location_kind: { type: "string", enum: [...LOCATIONS] },
        slug: { type: "string", description: "Link name, lowercase letters, numbers and dashes; made from the title if omitted" },
      },
      required: ["title", "duration_minutes"],
      additionalProperties: false,
    },
  },
];

const PROPOSALS: Record<string, AssistantAction["kind"]> = {
  propose_cancel_meeting: "cancel_meeting",
  propose_create_event_type: "create_event_type",
};
export const isProposal = (name: string) => name in PROPOSALS;

// ---- Running tools ----------------------------------------------------------------------------------

export interface ToolContext {
  user: User;
  /** Collects the changes proposed during this turn. */
  proposals: AssistantAction[];
}

const dayRange = (tz: string, from?: string, to?: string, defaultDays = 14, maxDays = 92) => {
  const start = from ? DateTime.fromISO(from, { zone: tz }) : DateTime.now().setZone(tz).startOf("day");
  const end = to ? DateTime.fromISO(to, { zone: tz }).plus({ days: 1 }) : start.plus({ days: defaultDays });
  if (!start.isValid || !end.isValid) throw new ToolError("Dates must be YYYY-MM-DD");
  if (end <= start) throw new ToolError("to_date must be on or after from_date");
  if (end.diff(start, "days").days > maxDays) throw new ToolError(`Ask for at most ${maxDays} days at a time`);
  return { start, end };
};

const when = (d: Date, tz: string) => DateTime.fromJSDate(d).setZone(tz).toFormat("ccc d LLL yyyy, HH:mm");
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

async function findEvent(user: User, id: unknown) {
  const event = (await routableEventTypes(user)).find((e) => e.id === id);
  if (!event) throw new ToolError("No event type with that id; call list_event_types");
  return event;
}

const Inputs = {
  list_meetings: z.object({
    from_date: z.string().optional(),
    to_date: z.string().optional(),
    search: z.string().max(200).optional(),
    include_cancelled: z.boolean().optional(),
  }),
  find_open_times: z.object({ event_type_id: z.string(), from_date: z.string(), to_date: z.string() }),
  get_booking_link: z.object({ event_type_id: z.string(), name: z.string().max(200).optional(), email: z.string().max(320).optional() }),
  propose_cancel_meeting: z.object({ booking_id: z.string(), reason: z.string().max(1000).optional() }),
  propose_create_event_type: z.object({
    title: z.string().trim().min(1).max(120),
    duration_minutes: z.number().int().min(5).max(720),
    description: z.string().max(2000).optional(),
    location_kind: z.enum(LOCATIONS).optional(),
    slug: z.string().optional(),
  }),
};

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new ToolError(`Invalid input: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return r.data;
}

/** Run one tool call; returns the result for the model (JSON text). Throws ToolError for bad input. */
export async function runTool(ctx: ToolContext, name: string, id: string, input: unknown): Promise<string> {
  const { user } = ctx;
  const tz = user.timeZone;
  switch (name) {
    case "list_event_types": {
      const routable = await routableEventTypes(user);
      const rows = routable.length ? await db.select().from(eventTypes).where(inArray(eventTypes.id, routable.map((e) => e.id))) : [];
      return JSON.stringify(
        routable.map((e) => {
          const row = rows.find((r) => r.id === e.id)!;
          return {
            id: e.id,
            title: e.title,
            duration_minutes: row.durationMinutes,
            team: row.teamId ? (row.scheduling === "collective" ? "collective" : "round-robin") : undefined,
            on: row.isActive,
            hidden: row.isHidden || undefined,
            group_seats: row.seatsPerSlot > 1 ? row.seatsPerSlot : undefined,
            price: row.priceAmount && row.priceCurrency ? formatPrice(row.priceAmount, row.priceCurrency) : undefined,
            link: `${config.appUrl}/${e.handle}/${e.slug}`,
          };
        }),
      );
    }

    case "list_meetings": {
      const p = parse(Inputs.list_meetings, input);
      const { start, end } = dayRange(tz, p.from_date, p.to_date);
      const term = p.search?.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
      const rows = await db
        .select({ b: bookings, title: eventTypes.title })
        .from(bookings)
        .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
        .innerJoin(bookingHosts, and(eq(bookingHosts.bookingId, bookings.id), eq(bookingHosts.hostId, user.id)))
        .where(
          and(
            gte(bookings.startAt, start.toJSDate()),
            lt(bookings.startAt, end.toJSDate()),
            p.include_cancelled ? ne(bookings.status, "rescheduled") : eq(bookings.status, "confirmed"),
            ne(bookings.paymentStatus, "pending"),
            term
              ? or(ilike(bookings.inviteeName, `%${term}%`), ilike(bookings.inviteeEmail, `%${term}%`), ilike(eventTypes.title, `%${term}%`))
              : undefined,
          ),
        )
        .orderBy(asc(bookings.startAt))
        .limit(50);
      return JSON.stringify({
        range: `${start.toISODate()} to ${end.minus({ days: 1 }).toISODate()}`,
        meetings: rows.map(({ b, title }) => ({
          id: b.id,
          event_type: title,
          start: when(b.startAt, tz),
          end: DateTime.fromJSDate(b.endAt).setZone(tz).toFormat("HH:mm"),
          status: b.status,
          invitee: b.inviteeName,
          email: b.inviteeEmail,
          answers: b.answers.length ? Object.fromEntries(b.answers.map((a) => [a.label, a.value])) : undefined,
          notes: b.notes ?? undefined,
          meeting_link: b.meetingUrl ?? undefined,
          paid: b.paymentStatus === "paid" || undefined,
        })),
      });
    }

    case "find_open_times": {
      const p = parse(Inputs.find_open_times, input);
      const event = await findEvent(user, p.event_type_id);
      const { start, end } = dayRange(tz, p.from_date, p.to_date, 7, 14);
      const slots = await getSlots(event.handle, event.slug, start.toUTC().toISO()!, end.toUTC().toISO()!);
      const byDay = new Map<string, string[]>();
      for (const s of slots) {
        const t = DateTime.fromISO(s.start).setZone(tz);
        const day = t.toFormat("ccc d LLL");
        byDay.set(day, [...(byDay.get(day) ?? []), t.toFormat("HH:mm")]);
      }
      return JSON.stringify({ event_type: event.title, time_zone: tz, open_times: Object.fromEntries(byDay), total: slots.length });
    }

    case "get_availability": {
      const [schedule] = await db.select().from(schedules).where(and(eq(schedules.userId, user.id), eq(schedules.isDefault, true)));
      if (!schedule) return JSON.stringify({ note: "No schedule set up yet" });
      const rules = await db.select().from(availabilityRules).where(eq(availabilityRules.scheduleId, schedule.id));
      const today = DateTime.now().setZone(schedule.timeZone).toISODate()!;
      const overrides = await db
        .select()
        .from(dateOverrides)
        .where(and(eq(dateOverrides.scheduleId, schedule.id), gte(dateOverrides.date, today)))
        .orderBy(asc(dateOverrides.date));
      const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
      return JSON.stringify({
        time_zone: schedule.timeZone,
        weekly: Object.fromEntries(
          DAYS.slice(1).map((d, i) => {
            const hours = rules.filter((r) => r.weekday === i + 1).sort((a, b) => a.startMinute - b.startMinute);
            return [d, hours.length ? hours.map((r) => `${hm(r.startMinute)}–${hm(r.endMinute)}`).join(", ") : "unavailable"];
          }),
        ),
        date_changes: overrides
          .filter((o) => o.date <= DateTime.fromISO(today).plus({ days: 60 }).toISODate()!)
          .map((o) => ({ date: o.date, hours: o.startMinute === null || o.endMinute === null ? "unavailable" : `${hm(o.startMinute)}–${hm(o.endMinute)}` })),
        edit_at: `${config.appUrl}/dashboard/availability`,
      });
    }

    case "get_booking_link": {
      const p = parse(Inputs.get_booking_link, input);
      const event = await findEvent(user, p.event_type_id);
      if (!p.name && !p.email) return JSON.stringify({ link: `${config.appUrl}/${event.handle}/${event.slug}` });
      const url = new URL(bookingLink({ ...event, questions: [] }, p.name ?? "", p.email ?? "", []));
      for (const k of ["name", "email"]) if (!url.searchParams.get(k)) url.searchParams.delete(k);
      return JSON.stringify({ link: url.toString() });
    }

    case "propose_cancel_meeting": {
      const p = parse(Inputs.propose_cancel_meeting, input);
      if (!/^[0-9a-f-]{36}$/.test(p.booking_id)) throw new ToolError("No meeting with that id; call list_meetings");
      const [row] = await db
        .select({ b: bookings, title: eventTypes.title })
        .from(bookings)
        .innerJoin(eventTypes, eq(eventTypes.id, bookings.eventTypeId))
        .innerJoin(bookingHosts, and(eq(bookingHosts.bookingId, bookings.id), eq(bookingHosts.hostId, user.id)))
        .where(eq(bookings.id, p.booking_id));
      if (!row) throw new ToolError("No meeting with that id; call list_meetings");
      if (row.b.status !== "confirmed") throw new ToolError("That meeting is already cancelled");
      if (row.b.endAt <= new Date()) throw new ToolError("That meeting is already over");
      const summary = `Cancel “${row.title}” with ${row.b.inviteeName} on ${when(row.b.startAt, tz)}${p.reason ? ` (reason: ${p.reason})` : ""}`;
      ctx.proposals.push({ id, kind: PROPOSALS[name], params: { bookingId: row.b.id, reason: p.reason ?? null }, summary, status: "pending" });
      return JSON.stringify({ status: "awaiting_confirmation", shown_to_user: summary });
    }

    case "propose_create_event_type": {
      const p = parse(Inputs.propose_create_event_type, input);
      const slug = toSlug(p.slug || p.title);
      const [clash] = await db
        .select({ id: eventTypes.id })
        .from(eventTypes)
        .where(and(eq(eventTypes.userId, user.id), isNull(eventTypes.teamId), eq(eventTypes.slug, slug)));
      if (clash) throw new ToolError(`You already have an event type at /${user.username}/${slug}; pick another slug`);
      const location = p.location_kind ?? "google_meet";
      const summary = `Create “${p.title}”, ${p.duration_minutes} min, ${LOCATION_LABEL[location]}, at ${config.appUrl}/${user.username}/${slug}`;
      ctx.proposals.push({
        id,
        kind: PROPOSALS[name],
        params: { title: p.title, durationMinutes: p.duration_minutes, description: p.description ?? null, locationKind: location, slug },
        summary,
        status: "pending",
      });
      return JSON.stringify({ status: "awaiting_confirmation", shown_to_user: summary });
    }
  }
  throw new ToolError(`Unknown tool ${name}`);
}

const LOCATION_LABEL: Record<(typeof LOCATIONS)[number], string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  phone: "phone call",
  in_person: "in person",
  custom: "custom location",
};

export const toSlug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "meeting";
