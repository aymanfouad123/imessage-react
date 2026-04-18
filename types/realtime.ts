import type { Chat, Message } from "@/lib/server/models";

export type BrowserEvent =
  /** Primary realtime event for new messages. Carries enough data for fanout without fetching full history. */
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
  /** Metadata-only chat update, for state such as read/unread changes. Never represents a new message. */
  | {
      kind: "chat.updated";
      chat_id: string;
      chat: Chat;
      event_id?: string;
    };
