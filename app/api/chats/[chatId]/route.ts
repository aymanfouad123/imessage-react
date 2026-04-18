import { NextResponse } from "next/server";
import * as store from "@/lib/server/store";
import type { ChatResponse } from "@/lib/server/models";

interface RouteContext {
  params: Promise<{ chatId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { chatId } = await context.params;

  try {
    const chat = store.getChat(chatId);
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    const response: ChatResponse = { chat };
    return NextResponse.json(response);
  } catch (e) {
    console.error("get chat failed", e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
