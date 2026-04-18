import { NextResponse } from "next/server";
import { broadcast } from "@/lib/server/ws-hub";
import * as store from "@/lib/server/store";

type AgentWebhookEvent =
  | {
      kind: "typing.started";
      run_id: string;
      chat_id: string;
    }
  | {
      kind: "typing.stopped";
      run_id: string;
      chat_id: string;
    }
  | {
      kind: "agent.message";
      run_id: string;
      chat_id: string;
      text: string;
      sender_handle: string;
    };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseAgentWebhookEvent(body: unknown): AgentWebhookEvent | string {
  if (!isRecord(body)) return "body must be an object";
  const kind = body.kind;
  if (
    kind !== "typing.started" &&
    kind !== "typing.stopped" &&
    kind !== "agent.message"
  ) {
    return "invalid kind";
  }

  const run_id = typeof body.run_id === "string" ? body.run_id : "";
  const chat_id = typeof body.chat_id === "string" ? body.chat_id : "";

  if (kind === "typing.started" || kind === "typing.stopped") {
    if (!run_id || !chat_id) {
      return "missing run_id or chat_id";
    }
    if (kind === "typing.started") {
      return { kind: "typing.started", run_id, chat_id };
    }
    return { kind: "typing.stopped", run_id, chat_id };
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  const sender_handle =
    typeof body.sender_handle === "string" ? body.sender_handle : "";
  if (!run_id || !chat_id || !text || !sender_handle) {
    return "missing run_id, chat_id, text, or sender_handle";
  }
  return {
    kind: "agent.message",
    run_id,
    chat_id,
    text,
    sender_handle,
  };
}

function authorize(request: Request): boolean {
  const secret =
    process.env.INTERNAL_AGENT_SECRET ?? "dev-internal-agent-secret";
  const auth = request.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

async function handleEvent(event: AgentWebhookEvent): Promise<void> {
  if (event.kind === "typing.started") {
    broadcast({
      kind: "typing",
      chat_id: event.chat_id,
      state: "started",
    });
    return;
  }

  if (event.kind === "typing.stopped") {
    broadcast({
      kind: "typing",
      chat_id: event.chat_id,
      state: "stopped",
    });
    return;
  }

  const result = store.sendMessage(event.chat_id, {
    text: event.text,
    as_me: false,
    from_handle: event.sender_handle,
  });
  if (!result) {
    throw new Error("Chat not found");
  }

  broadcast({
    kind: "message.created",
    chat_id: event.chat_id,
    chat: result.chat,
    message: result.message,
    event_id: result.message.id,
  });
}

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseAgentWebhookEvent(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }

  try {
    await handleEvent(parsed);
  } catch (e) {
    console.error("internal agent events", e);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
