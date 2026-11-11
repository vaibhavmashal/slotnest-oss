// The rule logic of routing forms, kept free of the database so it can be tested on its own.
import { z } from "zod";
import type { BookingAnswer, BookingQuestion, RouteTarget, RoutingRule } from "@/db/schema";
import { config } from "@/lib/config";
import { isHttpsUrl } from "@/lib/urls";

export const MAX_RULES = 20;
export const MAX_MESSAGE_LENGTH = 1000;

export interface RoutableEvent {
  id: string;
  title: string;
  handle: string;
  slug: string;
  questions: BookingQuestion[];
  isActive: boolean;
}

// ---- Rules ------------------------------------------------------------------------------------------

const TargetInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("event"), eventTypeId: z.string() }),
  z.object({ type: z.literal("url"), url: z.string().trim().max(2000) }),
  z.object({ type: z.literal("message"), text: z.string().trim().max(MAX_MESSAGE_LENGTH) }),
]);

const RuleInput = z.object({
  id: z.string().regex(/^[a-z0-9]{1,16}$/).optional(),
  questionId: z.string(),
  op: z.enum(["is", "is_not", "contains"]),
  value: z.string().trim().max(200),
  target: TargetInput,
});

/** A target from the editor, or null when it points at an event type the owner can't route to or is incomplete. */
export function parseTarget(raw: unknown, eventTypeIds: Set<string>): RouteTarget | null {
  const t = TargetInput.safeParse(raw);
  if (!t.success) return null;
  if (t.data.type === "event") return eventTypeIds.has(t.data.eventTypeId) ? t.data : null;
  if (t.data.type === "url") return isHttpsUrl(t.data.url) ? t.data : null;
  return t.data.text ? t.data : null;
}

/** The rules from the editor (a JSON string); rules without a value are dropped. Null when any rule is invalid. */
export function parseRules(json: string, questions: BookingQuestion[], eventTypeIds: Set<string>): RoutingRule[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json || "[]");
  } catch {
    return null;
  }
  const parsed = z.array(RuleInput).max(MAX_RULES).safeParse(raw);
  if (!parsed.success) return null;
  const out: RoutingRule[] = [];
  for (const [i, r] of parsed.data.entries()) {
    if (!r.value) continue;
    if (!questions.some((q) => q.id === r.questionId)) return null;
    const target = parseTarget(r.target, eventTypeIds);
    if (!target) return null;
    out.push({ id: r.id ?? `r${i}`, questionId: r.questionId, op: r.op, value: r.value, target });
  }
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

export function ruleMatches(rule: Pick<RoutingRule, "op" | "value">, answer: string | undefined): boolean {
  const a = norm(answer ?? "");
  const v = norm(rule.value);
  if (rule.op === "is") return a === v;
  if (rule.op === "is_not") return a !== v;
  return a !== "" && a.includes(v);
}

/** Where someone with these answers goes: the first matching rule, else the fallback. */
export function pickTarget(form: { routes: RoutingRule[]; fallback: RouteTarget }, answers: BookingAnswer[]): RouteTarget {
  const byId = new Map(answers.map((a) => [a.id, a.value]));
  return form.routes.find((r) => ruleMatches(r, byId.get(r.questionId)))?.target ?? form.fallback;
}

/**
 * The booking page link for an event type, with name, email and answers filled in. A form answer fills in the event
 * type's question with the same wording (ignoring case), so hosts don't make people answer twice.
 */
export function bookingLink(event: Pick<RoutableEvent, "handle" | "slug" | "questions">, name: string, email: string, answers: BookingAnswer[]): string {
  const q = new URLSearchParams({ name, email });
  for (const eq of event.questions) {
    const a = answers.find((x) => norm(x.label) === norm(eq.label));
    if (a && (eq.type !== "select" || eq.options?.includes(a.value))) q.set(`a_${eq.id}`, a.value);
  }
  return `${config.appUrl}/${event.handle}/${event.slug}?${q}`;
}

/** "Book: Intro call", "Page: https://…", "Message" for the editor's summaries. */
export function describeTarget(t: RouteTarget, events: Pick<RoutableEvent, "id" | "title">[]): string {
  if (t.type === "event") return `Book: ${events.find((e) => e.id === t.eventTypeId)?.title ?? "(deleted event type)"}`;
  if (t.type === "url") return `Page: ${t.url}`;
  return "Show a message";
}
