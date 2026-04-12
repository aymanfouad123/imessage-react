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
): SendMessageRequest | string => {
  if (!body || typeof body !== "object") {
    return "Request body must be an object";
  }

  const value = body as Record<string, unknown>;
  const text = typeof value.text === "string" ? value.text.trim() : "";
  const direction = value.direction;
  const senderHandle =
    typeof value.sender_handle === "string"
      ? value.sender_handle.trim()
      : undefined;

  if (!text) return "text is required";
  if (
    direction !== undefined &&
    direction !== "inbound" &&
    direction !== "outbound"
  ) {
    return "direction must be inbound or outbound";
  }
  if (direction === "inbound" && !senderHandle) {
    return "sender_handle is required for inbound messages";
  }

  return {
    text,
    direction,
    sender_handle: senderHandle,
  };
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
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  const result = sendMessage(chatId, parsed);
  if (!result) {
    return NextResponse.json({ error: "Chat not found" }, { status: 404 });
  }

  const response: SendMessageResponse = result;
  return NextResponse.json(response, { status: 201 });
}
