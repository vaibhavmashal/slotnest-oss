import { describe, expect, it } from "vitest";
import type { BookingQuestion, RouteTarget, RoutingRule } from "@/db/schema";
import { bookingLink, parseRules, parseTarget, pickTarget, ruleMatches } from "./rules";

const size: BookingQuestion = { id: "size", label: "Company size", type: "select", required: true, options: ["1-10", "11-200", "200+"] };
const topic: BookingQuestion = { id: "topic", label: "What do you need?", type: "text", required: false };
const sales: RouteTarget = { type: "event", eventTypeId: "ev-sales" };
const intro: RouteTarget = { type: "event", eventTypeId: "ev-intro" };
const events = new Set(["ev-sales", "ev-intro"]);

const rule = (r: Partial<RoutingRule>): RoutingRule => ({ id: "r", questionId: "size", op: "is", value: "200+", target: sales, ...r });

describe("ruleMatches", () => {
  it("compares answers ignoring case and surrounding spaces", () => {
    expect(ruleMatches({ op: "is", value: "200+" }, " 200+ ")).toBe(true);
    expect(ruleMatches({ op: "is", value: "Yes" }, "yes")).toBe(true);
    expect(ruleMatches({ op: "is_not", value: "1-10" }, "200+")).toBe(true);
    expect(ruleMatches({ op: "is_not", value: "1-10" }, "1-10")).toBe(false);
    expect(ruleMatches({ op: "contains", value: "billing" }, "A Billing question")).toBe(true);
  });

  it("doesn't treat a blank answer as containing anything", () => {
    expect(ruleMatches({ op: "contains", value: "x" }, "")).toBe(false);
    expect(ruleMatches({ op: "contains", value: "x" }, undefined)).toBe(false);
  });
});

describe("pickTarget", () => {
  const form = {
    routes: [rule({}), rule({ id: "r2", questionId: "topic", op: "contains", value: "support", target: { type: "url", url: "https://help.example.com" } })],
    fallback: intro,
  };

  it("uses the first rule that matches", () => {
    const answers = [
      { id: "size", label: "Company size", value: "200+" },
      { id: "topic", label: "What do you need?", value: "support" },
    ];
    expect(pickTarget(form, answers)).toEqual(sales);
  });

  it("falls through to later rules, then the fallback", () => {
    expect(pickTarget(form, [{ id: "size", label: "", value: "1-10" }, { id: "topic", label: "", value: "Need support" }])).toEqual({
      type: "url",
      url: "https://help.example.com",
    });
    expect(pickTarget(form, [{ id: "size", label: "", value: "1-10" }])).toEqual(intro);
  });
});

describe("parseRules", () => {
  it("accepts valid rules and drops ones without a value", () => {
    const json = JSON.stringify([rule({ id: "a1" }), rule({ id: "a2", value: " " })]);
    expect(parseRules(json, [size, topic], events)).toEqual([rule({ id: "a1" })]);
  });

  it("rejects unknown questions, event types the owner can't use, and non-https pages", () => {
    expect(parseRules(JSON.stringify([rule({ questionId: "gone" })]), [size], events)).toBeNull();
    expect(parseRules(JSON.stringify([rule({ target: { type: "event", eventTypeId: "someone-else" } })]), [size], events)).toBeNull();
    expect(parseRules(JSON.stringify([rule({ target: { type: "url", url: "http://example.com" } })]), [size], events)).toBeNull();
    expect(parseRules("not json", [size], events)).toBeNull();
  });

  it("needs text for a message", () => {
    expect(parseTarget({ type: "message", text: "  " }, events)).toBeNull();
    expect(parseTarget({ type: "message", text: "Thanks!" }, events)).toEqual({ type: "message", text: "Thanks!" });
  });
});

describe("bookingLink", () => {
  it("fills in name, email and the event type's questions with the same wording", () => {
    const event = {
      handle: "jo",
      slug: "sales",
      questions: [
        { id: "q1", label: "company size", type: "select", required: false, options: ["200+"] },
        { id: "q2", label: "Phone", type: "phone", required: false },
      ] as BookingQuestion[],
    };
    const url = new URL(bookingLink(event, "Ann Lee", "ann@example.com", [{ id: "size", label: "Company Size", value: "200+" }]));
    expect(url.pathname).toBe("/jo/sales");
    expect(url.searchParams.get("name")).toBe("Ann Lee");
    expect(url.searchParams.get("email")).toBe("ann@example.com");
    expect(url.searchParams.get("a_q1")).toBe("200+");
    expect(url.searchParams.has("a_q2")).toBe(false);
  });

  it("skips a dropdown answer the event type doesn't offer", () => {
    const event = { handle: "jo", slug: "x", questions: [{ id: "q1", label: "Company size", type: "select", required: false, options: ["Small"] }] as BookingQuestion[] };
    expect(new URL(bookingLink(event, "A", "a@b.co", [{ id: "s", label: "Company size", value: "200+" }])).searchParams.has("a_q1")).toBe(false);
  });
});
