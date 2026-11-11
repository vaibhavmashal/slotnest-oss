import { newConversation } from "@/lib/assistant";
import { handle } from "../shared";

/** Start a new, empty conversation. */
export async function POST() {
  return handle(async (user) => ({ conversationId: (await newConversation(user.id)).id, entries: [] }));
}
