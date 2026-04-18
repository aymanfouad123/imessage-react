import { NextResponse } from "next/server";
import { broadcast } from "@/lib/server/ws-hub";
import * as store from "@/lib/server/store";
import type {
  CreateChatRequest,
  CreateChatResponse,
  ListChatsResponse,
  MessageService,
} from "@/lib/server/models";

const isService = (service: unknown): service is MessageService =>
  service === "iMessage" || service === "SMS";

const parseCreateChatRequest = (body: unknown): CreateChatRequest | string => {
  if (!body || typeof body !== "object") {
    return "Request body must be an object";
  }

  const value = body as Record<string, unknown>;
  const handles = Array.isArray(value.handles)
    ? value.handles
        .filter((handle): handle is string => typeof handle === "string")
        .map((handle) => handle.trim())
        .filter(Boolean)
    : [];
  const text = typeof value.text === "string" ? value.text.trim() : "";
  const service = value.service;
  const displayName =
    typeof value.display_name === "string" ? value.display_name.trim() : undefined;

  if (handles.length === 0) return "handles must include at least one handle";
  if (!text) return "text is required";
  if (service !== undefined && !isService(service)) {
    return "service must be iMessage or SMS";
  }

  return {
    handles,
    text,
    service,
    display_name: displayName,
  };
};

export async function GET() {
  try {
    const chats = store.listChats();
    const response: ListChatsResponse = { chats };
    return NextResponse.json(response);
  } catch (e) {
    console.error("list chats failed", e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  const parsed = parseCreateChatRequest(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  try {
    const response: CreateChatResponse = store.createChat(parsed);
    broadcast({
      kind: "message.created",
      chat_id: response.chat.id,
      chat: response.chat,
      message: response.message,
      event_id: response.message.id,
    });
    return NextResponse.json(response, { status: 201 });
  } catch (e) {
    console.error("create chat failed", e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
