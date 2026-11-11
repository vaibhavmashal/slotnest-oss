import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { assistantAvailable, latestConversation, transcript } from "@/lib/assistant";
import AssistantChat from "./AssistantChat";

export const metadata = { title: "Assistant · Slotnest" };

export default async function Assistant() {
  const user = await requireUser();
  // Switched off until an Anthropic key is set; there's no nav link either.
  if (!assistantAvailable()) notFound();
  const convo = await latestConversation(user.id);
  return <AssistantChat conversationId={convo?.id ?? null} initial={convo ? transcript(convo) : []} firstName={user.name.split(" ")[0]} />;
}
