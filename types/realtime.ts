import type { Chat, Message } from "@/lib/server/models";

export type BrowserEvent =
  | {
      kind: "message.created";
      chat_id: string;
      chat: Chat;
      message: Message;
      event_id?: string;
    }
  | {
      kind: "typing";
      chat_id: string;
      state: "started" | "stopped";
      event_id?: string;
    }
  | {
      kind: "chat.updated";
      chat_id: string;
      chat: Chat;
      event_id?: string;
    };
