import { v4 as uuidv4 } from "uuid";
import { initialConversations } from "@/data/initial-conversations";
import type {
  Chat,
  ChatHandle,
  CreateChatRequest,
  Message,
  MessageService,
} from "./models";

const chats = new Map<string, Chat>();
const messagesByChat = new Map<string, Message[]>();

const nowIso = () => new Date().toISOString();

const makeHandle = (
  handle: string,
  service: MessageService,
  is_me = false
): ChatHandle => ({
  id: uuidv4(),
  handle,
  service,
  is_me,
});

const getDisplayName = (handles: string[], displayName?: string) => {
  const trimmedDisplayName = displayName?.trim();
  if (trimmedDisplayName) return trimmedDisplayName;
  return handles.join(", ");
};

const seedStore = () => {
  if (chats.size > 0) return;

  for (const conversation of initialConversations) {
    const service: MessageService = "iMessage";
    const recipientHandles = conversation.recipients.map((recipient) =>
      makeHandle(recipient.name, service)
    );
    const chat: Chat = {
      id: conversation.id,
      display_name:
        conversation.name ??
        conversation.recipients.map((recipient) => recipient.name).join(", "),
      handles: [...recipientHandles, makeHandle("me", service, true)],
      service,
      is_group: conversation.recipients.length > 1,
      created_at:
        conversation.messages[0]?.timestamp ?? conversation.lastMessageTime,
      updated_at: conversation.lastMessageTime,
      unread_count: conversation.unreadCount,
    };

    const chatMessages = conversation.messages.map<Message>((message) => {
      const isFromMe = message.sender === "me";
      const createdAt = message.timestamp;
      return {
        id: message.id,
        chat_id: chat.id,
        from_handle: isFromMe ? undefined : message.sender,
        is_from_me: isFromMe,
        text: message.content,
        created_at: createdAt,
        sent_at: createdAt,
        delivered_at: createdAt,
        read_at: isFromMe || conversation.unreadCount === 0 ? createdAt : null,
        is_delivered: true,
        is_read: isFromMe || conversation.unreadCount === 0,
      };
    });

    chats.set(chat.id, chat);
    messagesByChat.set(chat.id, chatMessages);
  }
};

seedStore();

export const listChats = () =>
  [...chats.values()].sort(
    (a, b) =>
      new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  );

export const getChat = (chatId: string) => chats.get(chatId) ?? null;

export const getMessages = (chatId: string) =>
  [...(messagesByChat.get(chatId) ?? [])].sort(
    (a, b) =>
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );

export const createChat = (request: CreateChatRequest) => {
  const service = request.service ?? "iMessage";
  const timestamp = nowIso();
  const recipientHandles = request.handles.map((handle) =>
    makeHandle(handle, service)
  );
  const chat: Chat = {
    id: uuidv4(),
    display_name: getDisplayName(request.handles, request.display_name),
    handles: [...recipientHandles, makeHandle("me", service, true)],
    service,
    is_group: request.handles.length > 1,
    created_at: timestamp,
    updated_at: timestamp,
    unread_count: 0,
  };
  const message: Message = {
    id: uuidv4(),
    chat_id: chat.id,
    is_from_me: true,
    text: request.text,
    created_at: timestamp,
    sent_at: timestamp,
    delivered_at: timestamp,
    read_at: timestamp,
    is_delivered: true,
    is_read: true,
  };

  chats.set(chat.id, chat);
  messagesByChat.set(chat.id, [message]);

  return { chat, message };
};

export const sendMessage = (chatId: string, text: string) => {
  const chat = chats.get(chatId);
  if (!chat) return null;

  const timestamp = nowIso();
  const message: Message = {
    id: uuidv4(),
    chat_id: chatId,
    is_from_me: true,
    text,
    created_at: timestamp,
    sent_at: timestamp,
    delivered_at: timestamp,
    read_at: timestamp,
    is_delivered: true,
    is_read: true,
  };
  const updatedChat = { ...chat, updated_at: timestamp, unread_count: 0 };

  messagesByChat.set(chatId, [...getMessages(chatId), message]);
  chats.set(chatId, updatedChat);

  return { chat: updatedChat, message };
};

export const markChatRead = (chatId: string) => {
  const chat = chats.get(chatId);
  if (!chat) return null;

  const timestamp = nowIso();
  const messages = getMessages(chatId).map((message) =>
    message.is_from_me
      ? message
      : {
          ...message,
          read_at: message.read_at ?? timestamp,
          is_read: true,
        }
  );
  const updatedChat = { ...chat, unread_count: 0 };

  messagesByChat.set(chatId, messages);
  chats.set(chatId, updatedChat);

  return { chat: updatedChat, messages };
};
