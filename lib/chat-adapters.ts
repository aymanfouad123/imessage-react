import type {
  Chat,
  ChatHandle,
  Message as ApiMessage,
} from "@/lib/server/models";
import type { Conversation, Message } from "@/types";

export interface ChatWithMessages {
  chat: Chat;
  messages?: ApiMessage[];
}

const getNonMeHandles = (chat: Chat) =>
  chat.handles.filter((handle) => !handle.is_me);

const toRecipient = (handle: ChatHandle) => ({
  id: handle.id,
  name: handle.handle,
});

export const toUiMessage = (
  message: ApiMessage,
  chat: Chat
): Message => {
  const fallbackHandle = getNonMeHandles(chat)[0]?.handle ?? "Unknown";
  const status = message.is_from_me
    ? message.is_read
      ? "read"
      : message.is_delivered
        ? "delivered"
        : undefined
    : undefined;

  return {
    id: message.id,
    content: message.text,
    sender: message.is_from_me ? "me" : message.from_handle ?? fallbackHandle,
    timestamp: message.created_at,
    status,
  };
};

export const toUiConversation = ({
  chat,
  messages = [],
}: ChatWithMessages): Conversation => {
  const recipients = getNonMeHandles(chat).map(toRecipient);

  return {
    id: chat.id,
    name: chat.display_name,
    recipients,
    messages: messages.map((message) => toUiMessage(message, chat)),
    lastMessageTime: chat.updated_at,
    unreadCount: chat.unread_count ?? 0,
    isAgentChat: chat.is_agent_chat ?? false,
    pinned: false,
    hideAlerts: false,
  };
};
