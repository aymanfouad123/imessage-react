import { NextResponse } from "next/server";
import { getChat } from "@/lib/server/store";
import type { ChatResponse } from "@/lib/server/models";

interface RouteContext {
  params: Promise<{ chatId: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { chatId } = await context.params;
  const chat = getChat(chatId);

  if (!chat) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const response: ChatResponse = { chat };
  return NextResponse.json(response);
}
