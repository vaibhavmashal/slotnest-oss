// Custom booking questions: what an event type asks invitees, and checking their answers.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { BookingAnswer, BookingQuestion } from "@/db/schema";

export const MAX_QUESTIONS = 10;
export const MAX_ANSWER_LENGTH = 2000;
const MAX_OPTIONS = 20;

const QuestionInput = z.object({
  id: z.string().regex(/^[a-z0-9]{1,16}$/).optional(),
  label: z.string().trim().max(200),
  type: z.enum(["text", "textarea", "phone", "select"]),
  required: z.boolean(),
  options: z.array(z.string().trim().max(100)).max(MAX_OPTIONS).optional(),
});

/**
 * The questions from the event type editor (a JSON string). Blank questions are dropped, dropdowns need at least
 * one option, and each question keeps (or gets) a short stable id so answers and prefill links can refer to it.
 */
export function parseQuestions(json: string): BookingQuestion[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json || "[]");
  } catch {
    return null;
  }
  const parsed = z.array(QuestionInput).max(MAX_QUESTIONS).safeParse(raw);
  if (!parsed.success) return null;
  const out: BookingQuestion[] = [];
  const seen = new Set<string>();
  for (const q of parsed.data) {
    if (!q.label) continue;
    let id = q.id && !seen.has(q.id) ? q.id : randomBytes(4).toString("hex");
    while (seen.has(id)) id = randomBytes(4).toString("hex");
    seen.add(id);
    if (q.type === "select") {
      const options = [...new Set((q.options ?? []).filter(Boolean))];
      if (options.length === 0) return null;
      out.push({ id, label: q.label, type: q.type, required: q.required, options });
    } else {
      out.push({ id, label: q.label, type: q.type, required: q.required });
    }
  }
  return out;
}

export class AnswerError extends Error {}

const PHONE_RE = /^\+?[0-9 ().-]{5,30}$/;

/** Check an invitee's answers ({ questionId: value }) against the questions; returns them in question order. */
export function checkAnswers(questions: BookingQuestion[], given: Record<string, unknown> | undefined): BookingAnswer[] {
  const out: BookingAnswer[] = [];
  for (const q of questions) {
    const v = typeof given?.[q.id] === "string" ? (given[q.id] as string).trim() : "";
    if (!v) {
      if (q.required) throw new AnswerError(`Please answer "${q.label}"`);
      continue;
    }
    if (v.length > MAX_ANSWER_LENGTH) throw new AnswerError(`The answer to "${q.label}" is too long`);
    if (q.type === "phone" && !PHONE_RE.test(v)) throw new AnswerError(`"${q.label}" needs a valid phone number`);
    if (q.type === "select" && !q.options?.includes(v)) throw new AnswerError(`Please choose an option for "${q.label}"`);
    out.push({ id: q.id, label: q.label, value: v });
  }
  return out;
}

/** "Company: Acme" lines for emails and calendar events. */
export const answerLines = (answers: BookingAnswer[]) => answers.map((a) => `${a.label}: ${a.value}`);
