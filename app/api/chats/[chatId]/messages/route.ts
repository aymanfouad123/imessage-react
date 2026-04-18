import { NextResponse } from "next/server";
import { broadcast } from "@/lib/server/ws-hub";
import { startAgentRun } from "@/lib/server/agent-runtime";
import * as store from "@/lib/server/store";
import type {
  MessagesResponse,
  SendMessageResponse,
} from "@/lib/server/models";

interface RouteContext {
  params: Promise<{ chatId: string }>;
}

const parseSendMessageBody = (body: unknown): { text: string } | string => {
  if (!body || typeof body !== "object") {
    return "Request body must be an object";
  }

  const value = body as Record<string, unknown>;
  const text = typeof value.text === "string" ? value.text.trim() : "";

  if (!text) return "text is required";

  return { text };
};

export async function GET(_request: Request, context: RouteContext) {
  const { chatId } = await context.params;

  try {
    if (!store.getChat(chatId)) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    const messages = store.getMessages(chatId);
    const response: MessagesResponse = { messages };
    return NextResponse.json(response);
  } catch (e) {
    console.error("get messages failed", e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}

export async function POST(request: Request, context: RouteContext) {
  const { chatId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 }
    );
  }

  const parsed = parseSendMessageBody(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  try {
    const result = store.sendMessage(chatId, {
      text: parsed.text,
      as_me: true,
    });
    if (!result) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
    broadcast({
      kind: "message.created",
      chat_id: chatId,
      chat: result.chat,
      message: result.message,
      event_id: result.message.id,
    });
    let agentRun: SendMessageResponse["agent_run"];
    if (result.chat.is_agent_chat) {
      const recent = store.getMessages(chatId);
      agentRun = await startAgentRun({
        chat_id: chatId,
        user_message_id: result.message.id,
        recent_messages: recent,
        agent_handle: process.env.AGENT_SENDER_HANDLE ?? "Pepper",
      });
    }
    const response: SendMessageResponse = { ...result, agent_run: agentRun };
    return NextResponse.json(response, { status: 201 });
  } catch (e) {
    console.error("send message failed", e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
