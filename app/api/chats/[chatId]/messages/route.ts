import { NextResponse } from "next/server";
import { getChat, getMessages, sendMessage } from "@/lib/server/store";
import type {
  MessagesResponse,
  SendMessageRequest,
  SendMessageResponse,
} from "@/lib/server/models";

interface RouteContext {
  params: Promise<{ chatId: string }>;
}

const parseSendMessageRequest = (
  body: unknown
): SendMessageRequest | null => {
  if (!body || typeof body !== "object") return null;
  const text = (body as Record<string, unknown>).text;
  return typeof text === "string" && text.trim()
    ? { text: text.trim() }
    : null;
};

export async function GET(_request: Request, context: RouteContext) {
  const { chatId } = await context.params;

  if (!getChat(chatId)) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const response: MessagesResponse = { messages: getMessages(chatId) };
  return NextResponse.json(response);
}

export async function POST(request: Request, context: RouteContext) {
  const { chatId } = await context.params;

  if (!getChat(chatId)) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  const parsed = parseSendMessageRequest(body);
  if (!parsed) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const result = sendMessage(chatId, parsed.text);
  if (!result) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const response: SendMessageResponse = result;
  return NextResponse.json(response, { status: 201 });
}
