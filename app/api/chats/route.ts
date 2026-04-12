import { NextResponse } from "next/server";
import { createChat, listChats } from "@/lib/server/store";
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
  const response: ListChatsResponse = { chats: listChats() };
  return NextResponse.json(response);
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

  const response: CreateChatResponse = createChat(parsed);
  return NextResponse.json(response, { status: 201 });
}
