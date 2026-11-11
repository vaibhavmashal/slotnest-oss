import type { NextRequest } from "next/server";
import { newConversation, sendMessage, transcript } from "@/lib/assistant";
import { handle } from "../shared";

/** Send a message: { conversationId?, text } → { conversationId, entries, notice? }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handle(async (user) => {
    const id = typeof body.conversationId === "string" ? body.conversationId : (await newConversation(user.id)).id;
    const { conversation, notice } = await sendMessage(user, id, typeof body.text === "string" ? body.text : "");
    return { conversationId: conversation.id, entries: transcript(conversation), notice };
  });
}
