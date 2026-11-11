// The assistant loop against the dev Postgres, with the Anthropic API replaced by a scripted fake (no network, no key).
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { eq } from "drizzle-orm";

const fake = vi.hoisted(() => {
  // Each entry answers one model call; `requests` records what the loop sent.
  const script: ((req: any) => any)[] = [];
  const requests: any[] = [];
  const reply = (content: any[], stop_reason = "end_turn") => ({
    id: "msg_fake",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  });
  const client = {
    beta: {
      messages: {
        create: async (req: any) => {
          requests.push(structuredClone(req));
          const next = script.shift();
          if (!next) throw new Error("no scripted reply left");
          return next(req);
        },
      },
    },
  };
  return { client, script, requests, reply };
});

vi.mock("./client", () => ({ anthropic: () => fake.client }));
vi.mock("@/lib/config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/config")>();
  return { ...mod, config: { ...mod.config, anthropic: { apiKey: "sk-ant-fake", model: "claude-opus-5-5", dailyLimit: 10 } } };
});

import { db, sql } from "@/db/client";
import { assistantUsage, bookings, eventTypes } from "@/db/schema";
import { createBooking } from "@/lib/booking/service";
import { boss } from "@/lib/jobs/queue";
import { fixtures, type User } from "@/lib/teams/test-fixtures";
import { AssistantError, decideAction, newConversation, sendMessage, transcript } from "./index";

const fx = fixtures("assist");
let host: User;
let eventId = "";
let bookingId = "";

beforeAll(async () => {
  host = await fx.makeUser("asst");
  const [schedule] = await sql`SELECT id FROM schedules WHERE user_id = ${host.id}`;
  const [e] = await db
    .insert(eventTypes)
    .values({ userId: host.id, scheduleId: schedule.id, slug: "intro", title: "Intro call", durationMinutes: 30, minimumNoticeMinutes: 0 })
    .returning();
  eventId = e.id;
  const start = DateTime.utc().plus({ days: 2 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toISO()!;
  const r = await createBooking({ handle: host.username, slug: "intro", start, inviteeName: "Ann Lee", inviteeEmail: "ann@example.test", inviteeTimeZone: "UTC" });
  bookingId = r.booking.id;
});

afterAll(async () => {
  await fx.cleanup();
  await (await boss()).stop({ graceful: false });
  await sql.end();
});

const toolUse = (id: string, name: string, input: unknown) => ({ type: "tool_use", id, name, input });
const text = (t: string) => ({ type: "text", text: t });

describe("assistant", () => {
  it("runs tools, sends results back in one message, and keeps the history append-only", async () => {
    const convo = await newConversation(host.id);
    fake.script.push(
      () => fake.reply([text("Let me check."), toolUse("tu_1", "list_meetings", {}), toolUse("tu_2", "list_event_types", {})], "tool_use"),
      () => fake.reply([text("You have one meeting: Intro call with Ann Lee.")]),
    );
    const { conversation } = await sendMessage(host, convo.id, "What's coming up?");

    const second = fake.requests.at(-1);
    const results = second.messages.at(-1);
    expect(results.role).toBe("user");
    expect(results.content.map((b: any) => b.tool_use_id)).toEqual(["tu_1", "tu_2"]);
    const meetings = JSON.parse(results.content[0].content).meetings;
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({ id: bookingId, invitee: "Ann Lee", event_type: "Intro call" });
    expect(JSON.parse(results.content[1].content)[0]).toMatchObject({ id: eventId, title: "Intro call", duration_minutes: 30 });
    // The user's message is followed by a system note with the current time.
    expect(second.messages[0]).toEqual({ role: "user", content: "What's coming up?" });
    expect(second.messages[1].role).toBe("system");
    expect(second.messages[1].content).toContain("UTC");

    expect(transcript(conversation)).toEqual([
      { role: "user", text: "What's coming up?" },
      { role: "assistant", text: "Let me check.\n\nYou have one meeting: Intro call with Ann Lee." },
    ]);

    // The next turn starts with exactly the stored history.
    fake.script.push(() => fake.reply([text("Sure.")]));
    await sendMessage(host, convo.id, "Thanks");
    const third = fake.requests.at(-1);
    expect(third.messages.slice(0, conversation.messages.length)).toEqual(conversation.messages);
  });

  it("only cancels a meeting after the user confirms, and tells the model with the next message", async () => {
    const convo = await newConversation(host.id);
    fake.script.push(
      () => fake.reply([toolUse("tu_c", "propose_cancel_meeting", { booking_id: bookingId, reason: "Out sick" })], "tool_use"),
      () => fake.reply([text("I've prepared that; confirm below.")]),
    );
    const { conversation } = await sendMessage(host, convo.id, "Cancel my meeting with Ann");
    const entries = transcript(conversation);
    expect(entries[1]).toMatchObject({ role: "action", action: { id: "tu_c", kind: "cancel_meeting", status: "pending" } });
    expect((await db.select().from(bookings).where(eq(bookings.id, bookingId)))[0].status).toBe("confirmed");

    const after = await decideAction(host, convo.id, "tu_c", true);
    expect(after.actions[0]).toMatchObject({ status: "done" });
    expect((await db.select().from(bookings).where(eq(bookings.id, bookingId)))[0].status).toBe("cancelled");
    // Confirming twice does nothing more.
    expect((await decideAction(host, convo.id, "tu_c", true)).actions[0].status).toBe("done");

    fake.script.push(() => fake.reply([text("Done.")]));
    await sendMessage(host, convo.id, "Thanks");
    const note = fake.requests.at(-1).messages.at(-1);
    expect(note.role).toBe("system");
    expect(note.content).toContain("the user confirmed this proposed change: Cancel “Intro call” with Ann Lee");
  });

  it("returns tool errors to the model instead of failing the turn", async () => {
    const convo = await newConversation(host.id);
    fake.script.push(
      () => fake.reply([toolUse("tu_x", "find_open_times", { event_type_id: "nope", from_date: "2026-01-01", to_date: "2026-01-02" })], "tool_use"),
      () => fake.reply([text("I couldn't find that event type.")]),
    );
    await sendMessage(host, convo.id, "Open times?");
    const result = fake.requests.at(-1).messages.at(-1).content[0];
    expect(result).toMatchObject({ tool_use_id: "tu_x", is_error: true });
    expect(result.content).toContain("list_event_types");
  });

  it("counts messages and tokens per day, and stops at the daily limit", async () => {
    const [usage] = await db.select().from(assistantUsage).where(eq(assistantUsage.userId, host.id));
    // 5 messages so far, making 8 model calls of 100 input / 20 output tokens each.
    expect(usage).toMatchObject({ requests: 5, inputTokens: 800, outputTokens: 160 });
    await db.update(assistantUsage).set({ requests: 10 }).where(eq(assistantUsage.userId, host.id));
    const convo = await newConversation(host.id);
    const calls = fake.requests.length;
    await expect(sendMessage(host, convo.id, "one more")).rejects.toThrow(AssistantError);
    expect(fake.requests.length).toBe(calls);
  });

  it("keeps conversations private to their owner", async () => {
    const other = await fx.makeUser("other");
    const convo = await newConversation(host.id);
    await expect(sendMessage(other, convo.id, "hello")).rejects.toThrow("Conversation not found");
  });
});
