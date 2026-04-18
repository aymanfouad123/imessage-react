import { NextResponse } from "next/server";
import { broadcast } from "@/lib/server/ws-hub";
import * as store from "@/lib/server/store";
import type { ReadChatResponse } from "@/lib/server/models";

interface RouteContext {
  params: Promise<{ chatId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { chatId } = await context.params;
  try {
    const result = store.markChatRead(chatId);
    if (!result) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    broadcast({
      kind: "chat.updated",
      chat_id: chatId,
      chat: result.chat,
    });
    const response: ReadChatResponse = result;
    return NextResponse.json(response);
  } catch (e) {
    console.error("mark read failed", e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
