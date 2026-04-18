import { v4 as uuidv4 } from "uuid";
import type { Message } from "./models";

export interface AgentRunStartResult {
  run_id: string;
  ok: boolean;
  error?: string;
}

export async function startAgentRun(params: {
  chat_id: string;
  user_message_id: string;
  recent_messages: Message[];
  agent_handle: string;
}): Promise<AgentRunStartResult> {
  const base = (
    process.env.AGENT_RUNTIME_URL ?? "http://127.0.0.1:8000"
  ).replace(/\/$/, "");
  const run_id = uuidv4();
  try {
    const res = await fetch(`${base}/agent/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        run_id,
        chat_id: params.chat_id,
        trigger: {
          reason: "user_message",
          message_id: params.user_message_id,
        },
        context: {
          recent_messages: params.recent_messages,
          agent_handle: params.agent_handle,
        },
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const error = `agent runtime returned ${res.status}${
        detail ? `: ${detail}` : ""
      }`;
      console.error("startAgentRun failed", error);
      return { run_id, ok: false, error };
    }
    return { run_id, ok: true };
  } catch (e) {
    console.error("startAgentRun error", e);
    return {
      run_id,
      ok: false,
      error: e instanceof Error ? e.message : "agent runtime unreachable",
    };
  }
}
