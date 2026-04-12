export type MessageService = "iMessage" | "SMS";

export interface ChatHandle {
  id: string;
  handle: string;
  service: MessageService;
  is_me: boolean;
}

export interface Chat {
  id: string;
  display_name: string;
  handles: ChatHandle[];
  service: MessageService;
  is_group: boolean;
  created_at: string;
  updated_at: string;
  unread_count?: number;
}

export interface Message {
  id: string;
  chat_id: string;
  from_handle?: string;
  is_from_me: boolean;
  text: string;
  created_at: string;
  sent_at: string;
  delivered_at: string | null;
  read_at: string | null;
  is_delivered: boolean;
  is_read: boolean;
}

export interface CreateChatRequest {
  handles: string[];
  text: string;
  service?: MessageService;
  display_name?: string;
}

export interface SendMessageRequest {
  text: string;
}

export interface ListChatsResponse {
  chats: Chat[];
}

export interface ChatResponse {
  chat: Chat;
}

export interface MessagesResponse {
  messages: Message[];
}

export interface CreateChatResponse {
  chat: Chat;
  message: Message;
}

export interface SendMessageResponse {
  chat: Chat;
  message: Message;
}

export interface ReadChatResponse {
  chat: Chat;
  messages: Message[];
}
