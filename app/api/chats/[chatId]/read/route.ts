import { NextResponse } from "next/server";
import { markChatRead } from "@/lib/server/store";
import type { ReadChatResponse } from "@/lib/server/models";

interface RouteContext {
  params: Promise<{ chatId: string }>;
}

export async function POST(_request: Request, context: RouteContext) {
  const { chatId } = await context.params;
  const result = markChatRead(chatId);

  if (!result) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const response: ReadChatResponse = result;
  return NextResponse.json(response);
}
