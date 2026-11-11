import type { NextRequest } from "next/server";
import { decideAction, transcript } from "@/lib/assistant";
import { handle } from "../shared";

/** Confirm or dismiss a proposed change: { conversationId, actionId, confirm } → { entries }. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handle(async (user) => {
    const c = await decideAction(user, String(body.conversationId ?? ""), String(body.actionId ?? ""), body.confirm === true);
    return { entries: transcript(c) };
  });
}
