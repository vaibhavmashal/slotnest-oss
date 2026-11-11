import { describe, expect, it } from "vitest";
import type { BookingQuestion } from "@/db/schema";
import { AnswerError, checkAnswers, parseQuestions } from "./questions";

describe("parseQuestions", () => {
  it("keeps ids, gives new questions one, and drops blank ones", () => {
    const qs = parseQuestions(
      JSON.stringify([
        { id: "abc123", label: "Company", type: "text", required: true },
        { label: "  ", type: "text", required: false },
        { label: "Team size", type: "select", required: false, options: ["1-10", "11-50", "1-10", ""] },
      ]),
    )!;
    expect(qs).toHaveLength(2);
    expect(qs[0]).toEqual({ id: "abc123", label: "Company", type: "text", required: true });
    expect(qs[1].id).toMatch(/^[0-9a-f]{8}$/);
    expect(qs[1].options).toEqual(["1-10", "11-50"]);
  });

  it("rejects dropdowns without options, unknown types, bad JSON and more than 10 questions", () => {
    expect(parseQuestions(JSON.stringify([{ label: "Size", type: "select", required: false, options: [] }]))).toBeNull();
    expect(parseQuestions(JSON.stringify([{ label: "x", type: "date", required: false }]))).toBeNull();
    expect(parseQuestions("{nope")).toBeNull();
    expect(parseQuestions(JSON.stringify(Array.from({ length: 11 }, () => ({ label: "q", type: "text", required: false }))))).toBeNull();
    expect(parseQuestions("")).toEqual([]);
  });

  it("never repeats an id", () => {
    const qs = parseQuestions(JSON.stringify([{ id: "dup", label: "A", type: "text", required: false }, { id: "dup", label: "B", type: "text", required: false }]))!;
    expect(new Set(qs.map((q) => q.id)).size).toBe(2);
  });
});

describe("checkAnswers", () => {
  const questions: BookingQuestion[] = [
    { id: "co", label: "Company", type: "text", required: true },
    { id: "ph", label: "Phone", type: "phone", required: false },
    { id: "sz", label: "Team size", type: "select", required: false, options: ["1-10", "11-50"] },
  ];

  it("returns answers in question order with their labels, skipping empty optional ones", () => {
    expect(checkAnswers(questions, { sz: "11-50", co: " Acme ", ph: "" })).toEqual([
      { id: "co", label: "Company", value: "Acme" },
      { id: "sz", label: "Team size", value: "11-50" },
    ]);
  });

  it("ignores answers to questions that don't exist", () => {
    expect(checkAnswers(questions, { co: "Acme", evil: "x" })).toHaveLength(1);
  });

  it("enforces required, phone format, dropdown options and length", () => {
    expect(() => checkAnswers(questions, {})).toThrow(AnswerError);
    expect(() => checkAnswers(questions, { co: "Acme", ph: "call me" })).toThrow(/phone/);
    expect(() => checkAnswers(questions, { co: "Acme", sz: "500+" })).toThrow(/option/);
    expect(() => checkAnswers(questions, { co: "x".repeat(2001) })).toThrow(/too long/);
    expect(checkAnswers(questions, { co: "Acme", ph: "+91 98765 43210" })[1].value).toBe("+91 98765 43210");
  });
});
