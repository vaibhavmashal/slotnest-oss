// Routing forms: a short public questionnaire (/f/{username}/{slug}) that sends each person where they belong.
// Rules are checked in order and the first match wins; everyone else gets the fallback. A target is one of the
// owner's event types (opened with their name, email and matching answers already filled in), an external page,
// or a message. Every submission is kept so the owner can see who filled it in and where they went.
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { eventTypes, routingForms, routingSubmissions, users, type BookingAnswer } from "@/db/schema";
import { checkAnswers } from "@/lib/booking/questions";
import { config } from "@/lib/config";
import { hasPaidFeatures, ownedTeam } from "@/lib/teams";
import { bookingLink, pickTarget, type RoutableEvent } from "./rules";

export * from "./rules";

type User = typeof users.$inferSelect;
type EventType = typeof eventTypes.$inferSelect;
export type RoutingForm = typeof routingForms.$inferSelect;

export class RoutingError extends Error {}

// ---- Event types a form can route to -------------------------------------------------------------

/** The user's own event types, plus their team's if they own one (the same list as the Event types page). */
export async function routableEventTypes(user: User): Promise<RoutableEvent[]> {
  const team = await ownedTeam(user.id);
  const own = await db
    .select()
    .from(eventTypes)
    .where(and(eq(eventTypes.userId, user.id), isNull(eventTypes.teamId)))
    .orderBy(asc(eventTypes.createdAt));
  const teamRows = team ? await db.select().from(eventTypes).where(eq(eventTypes.teamId, team.id)).orderBy(asc(eventTypes.createdAt)) : [];
  const row = (e: EventType, handle: string): RoutableEvent => ({ id: e.id, title: e.title, handle, slug: e.slug, questions: e.questions, isActive: e.isActive });
  return [...own.map((e) => row(e, user.username)), ...teamRows.map((e) => row(e, team!.slug))];
}

// ---- Public form ---------------------------------------------------------------------------------

export async function getPublicForm(username: string, slug: string): Promise<{ form: RoutingForm; owner: User } | null> {
  const [row] = await db
    .select({ form: routingForms, owner: users })
    .from(routingForms)
    .innerJoin(users, eq(users.id, routingForms.userId))
    .where(and(eq(users.username, username), eq(routingForms.slug, slug), eq(routingForms.isActive, true)));
  // Routing forms are a paid feature: on the Free plan the form is offline (it comes back on upgrading).
  if (!row || !(await hasPaidFeatures(row.owner))) return null;
  return row;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UNAVAILABLE = "Thanks! We'll be in touch soon.";

export type RouteResult = { redirect: string } | { message: string };

/** Check someone's answers, record the submission and work out where they go. */
export async function submitForm(form: RoutingForm, owner: User, input: { name: unknown; email: unknown; answers: Record<string, unknown> | undefined }): Promise<RouteResult> {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 200) : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase().slice(0, 320) : "";
  if (!name) throw new RoutingError("Please enter your name");
  if (!EMAIL_RE.test(email)) throw new RoutingError("Please enter a valid email address");
  let answers: BookingAnswer[];
  try {
    answers = checkAnswers(form.questions, input.answers);
  } catch (err) {
    throw new RoutingError((err as Error).message);
  }

  const target = pickTarget(form, answers);
  let result: RouteResult;
  let routedTo: string;
  if (target.type === "event") {
    const event = (await routableEventTypes(owner)).find((e) => e.id === target.eventTypeId && e.isActive);
    // The event type was deleted or switched off after the form was saved: don't strand them on an error page.
    result = event ? { redirect: bookingLink(event, name, email, answers) } : { message: UNAVAILABLE };
    routedTo = event ? event.title : "Unavailable event type";
  } else if (target.type === "url") {
    result = { redirect: target.url };
    routedTo = target.url;
  } else {
    result = { message: target.text };
    routedTo = "Message";
  }
  await db.insert(routingSubmissions).values({ formId: form.id, inviteeName: name, inviteeEmail: email, answers, routedTo });
  return result;
}

// ---- Dashboard ------------------------------------------------------------------------------------

export async function formsWithCounts(userId: string) {
  const forms = await db.select().from(routingForms).where(eq(routingForms.userId, userId)).orderBy(asc(routingForms.createdAt));
  if (!forms.length) return [];
  const counts = await db
    .select({ formId: routingSubmissions.formId, n: count() })
    .from(routingSubmissions)
    .where(inArray(routingSubmissions.formId, forms.map((f) => f.id)))
    .groupBy(routingSubmissions.formId);
  return forms.map((f) => ({ form: f, submissions: counts.find((c) => c.formId === f.id)?.n ?? 0 }));
}

export const formUrl = (username: string, slug: string) => `${config.appUrl}/f/${username}/${slug}`;
