# Chat Sandbox System Context

This document is the engineering reference for the local Linq-style chat sandbox that powers the iMessage-style frontend. It is intended for coding agents and backend engineers working against the current frontend contract.

Use this as a system architecture and API contract reference: what exists, what must not break, how backend models map into frontend state, and which identifiers are canonical.

## System Invariants

- `Chat.id` is the canonical thread identifier.
- URL route parameter `:chatId` maps directly to `Chat.id`.
- Frontend query string `?id=` maps directly to `Chat.id`.
- `Message.chat_id` must always equal the owning `Chat.id`.
- `ChatHandle.id` identifies a participant handle, not a chat thread.
- Backend models and JSON fields remain `snake_case`.
- Chats returned by `GET /api/chats` must be sorted by `updated_at` descending.
- Messages returned by `GET /api/chats/:chatId/messages` must be sorted by `created_at` ascending.
- `POST /api/chats/:chatId/read` must remain idempotent.
- `unread_count` is a chat-level value; opening a chat clears it through the read endpoint.
- The frontend may use UI view models internally, but backend API responses are the source of truth for core chat data.

## Source Files

- Backend models and DTOs: `lib/server/models.ts`
- In-memory sandbox store: `lib/server/store.ts`
- WebSocket hub + broadcast: `lib/server/ws-hub.ts`, `types/realtime.ts`
- Browser WebSocket client: `lib/client/realtime.ts`
- Custom Node entry (Next + `/ws`): `server.ts`
- Public API route handlers: `app/api/chats/**/route.ts`
- Internal agent API: `app/api/internal/agent/events/route.ts`, `lib/server/agent-runtime.ts`
- Frontend API-to-UI adapter: `lib/chat-adapters.ts`
- Main frontend chat state: `components/app.tsx`
- Existing UI-only types: `types/index.ts`
- Seed chat data: `data/initial-conversations.ts`
- Swappable agent runtime (Python): `agent_service/` (FastAPI `POST /agent/runs`, webhooks to Next)

## Architecture Overview

The browser talks **only** to Next.js: HTTP for chat actions (`/api/chats/*`), WebSocket (`/ws`) for realtime `BrowserEvent` updates. It does not call the Python service or any messaging provider directly.

Next.js is the **carrier** and source of truth for app state and persistence (in-memory `lib/server/store.ts`). Route handlers call `store` functions directly and return `404` when a `chatId` is missing. Chat mutations call `broadcast()` from the WebSocket hub so all connected clients receive `BrowserEvent` updates.

**Realtime:** `message.created` includes the updated `chat` snapshot, so the UI does not need a separate `chat.updated` for sends. `chat.updated` is only broadcast from `POST /api/chats/:chatId/read` (no new message).

The **agent runtime** (Python FastAPI): Next starts a run with `POST {AGENT_RUNTIME_URL}/agent/runs`. The agent posts back to `POST /api/internal/agent/events` (Bearer `INTERNAL_AGENT_SECRET`) with optional `typing.*` events and one `agent.message` event. The handler writes via the store and `broadcast`s the same message event shape as user-initiated actions.

Local dev runs the custom server (`pnpm dev` → `tsx server.ts`) so HTTP and `/ws` share one port.

The backend model layer is intentionally small:

- `Chat` is the conversation thread container.
- `ChatHandle` is one participant handle in a chat.
- `Message` is one item in a chat thread.

The frontend keeps local state for presentation and input concerns:

- selected chat id
- message drafts
- mobile/desktop layout state
- loading state
- UI-only flags inherited from the existing components

Core chat data comes from API responses and is transformed by `lib/chat-adapters.ts`.

## Core Models

All timestamps are ISO strings. Backend models use `snake_case`.

```ts
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
  is_agent_chat?: boolean;
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
```

### Chat

A `Chat` is the conversation thread. Every route that works with a specific thread uses `Chat.id`:

```txt
/api/chats/:chatId
/api/chats/:chatId/messages
/api/chats/:chatId/read
```

The frontend stores this same value in `activeConversation` and mirrors it into the URL as `?id=:chatId`.

### ChatHandle

A `ChatHandle` is one participant handle. The local user is represented by:

```ts
is_me: true
```

Recipient handles use:

```ts
is_me: false
```

Only non-me handles become visible recipients in the existing UI.

### Message

A `Message` belongs to a chat thread through `chat_id`. Do not model the thread relationship through a participant handle.

Sender display is derived as follows:

- `is_from_me: true` renders as the local sender.
- `is_from_me: false` renders as a received message.
- `from_handle` can identify the non-me sender for display.
- If `from_handle` is absent, the adapter falls back to the first non-me chat handle.

## Request DTOs

These request bodies are part of the current stable frontend contract.

### CreateChatRequest

```ts
export interface CreateChatRequest {
  handles: string[];
  text: string;
  service?: "iMessage" | "SMS";
  display_name?: string;
}
```

Contract details:

- `handles` contains recipient handles only.
- The backend creates/adds the local `"me"` handle.
- `text` is the first message in the new chat.
- `service` defaults to `"iMessage"` when omitted.
- `display_name` is optional; when omitted, it is derived from `handles`.

### SendMessageRequest

```ts
export interface SendMessageRequest {
  text: string;
}
```

Contract details:

- The current send endpoint creates local-user messages.
- Created messages have `is_from_me: true`.
- Created messages must use the URL `:chatId` as `Message.chat_id`.

## Response DTOs

```ts
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
  agent_run?: {
    run_id: string;
    ok: boolean;
    error?: string;
  };
}

export interface ReadChatResponse {
  chat: Chat;
  messages: Message[];
}
```

Errors use:

```ts
{ error: string }
```

Current status conventions:

- `400` for invalid JSON or invalid request body.
- `404` when a `chatId` does not exist.

## API Routes

### GET `/api/chats`

Returns all chats.

Response:

```ts
{
  chats: Chat[];
}
```

Contract:

- Sort by `updated_at` descending.
- The frontend hydrates each returned chat by calling `GET /api/chats/:chatId/messages`.

### POST `/api/chats`

Creates a chat and its first message.

Request:

```json
{
  "handles": ["Jane Smith"],
  "text": "Hey, are you free later?",
  "service": "iMessage",
  "display_name": "Jane Smith"
}
```

Response:

```ts
{
  chat: Chat;
  message: Message;
}
```

Contract:

- Create a new `Chat.id`.
- Create one non-me `ChatHandle` per requested recipient handle.
- Add a local `"me"` handle with `is_me: true`.
- Set `is_group` from the number of recipient handles.
- Create the first message with `chat_id: chat.id`.
- Return both the created chat and the created message.

### GET `/api/chats/:chatId`

Returns one chat by canonical thread id.

Response:

```ts
{
  chat: Chat;
}
```

Contract:

- `:chatId` must match `Chat.id`.
- Return `404` when the chat does not exist.

### GET `/api/chats/:chatId/messages`

Returns messages for one chat.

Response:

```ts
{
  messages: Message[];
}
```

Contract:

- Every returned message must have `message.chat_id === chatId`.
- Sort by `created_at` ascending.
- Return `404` when the chat does not exist.

### POST `/api/chats/:chatId/messages`

Creates a new message in an existing chat.

Request:

```json
{
  "text": "That works for me."
}
```

Response:

```ts
{
  chat: Chat;
  message: Message;
}
```

Contract:

- `:chatId` must match an existing `Chat.id`.
- Created message must have `chat_id: chatId`.
- Created message currently has `is_from_me: true`.
- Update the parent chat `updated_at`.
- Return the updated chat and created message.

### POST `/api/chats/:chatId/read`

Marks a chat read.

Response:

```ts
{
  chat: Chat;
  messages: Message[];
}
```

Contract:

- Idempotent: repeated calls must be safe and produce a read chat.
- Set `chat.unread_count` to `0`.
- Mark non-me messages in the chat as read.
- Preserve existing `read_at` timestamps when already present.
- Return `404` when the chat does not exist.

## Frontend Data Flow

The frontend uses existing UI types from `types/index.ts`, but backend API data is the source of truth for chat content.

### Initial Load

1. `components/app.tsx` renders the app shell immediately.
2. `isLoadingChats` shows loading skeletons while data loads.
3. The app calls `GET /api/chats`.
4. For each returned chat, the app calls `GET /api/chats/:chatId/messages`.
5. `lib/chat-adapters.ts` converts backend models into UI `Conversation` objects.
6. Desktop layout selects the first chat automatically.
7. Mobile layout starts with no selected chat.

### Selecting A Chat

1. `activeConversation` is set to the selected `Chat.id`.
2. Browser URL becomes `/?id=:chatId`.
3. The app calls `GET /api/chats/:chatId`.
4. The app calls `GET /api/chats/:chatId/messages`.
5. The app calls `POST /api/chats/:chatId/read`.
6. The returned chat/messages replace the current UI view model for that chat.

### Sending A Message

Existing chat:

1. Submit `SendMessageRequest` to `POST /api/chats/:chatId/messages`.
2. Merge the response into local UI state (and/or apply matching `message.created` from `/ws`; `chat.updated` only applies after mark-read).
3. Clear the local draft for that chat id.

For `is_agent_chat: true` threads, Next also triggers the agent runtime. The send response includes `agent_run`; if `ok` is false, the UI can show the startup error. Inbound agent messages arrive via the same WS events after the agent posts `agent.message` to the internal webhook.

New chat:

1. Convert comma-separated `recipientInput` into `CreateChatRequest.handles`.
2. Submit `CreateChatRequest` to `POST /api/chats`.
3. Select the returned `chat.id`.
4. Clear `recipientInput` and the `"new"` draft.

## Adapter Mapping

`lib/chat-adapters.ts` maps backend models to existing UI types.

### Chat To Conversation

```txt
Chat.id                -> Conversation.id
Chat.display_name      -> Conversation.name
Chat.updated_at        -> Conversation.lastMessageTime
Chat.unread_count      -> Conversation.unreadCount
Chat.handles !is_me    -> Conversation.recipients
Message[]              -> Conversation.messages
```

UI-only defaults currently set by the adapter:

```ts
pinned: false
hideAlerts: false
```

These are presentation fields from the existing UI. They are not part of the backend chat contract.

### ChatHandle To Recipient

```txt
ChatHandle.id      -> Recipient.id
ChatHandle.handle  -> Recipient.name
```

Only non-me handles become UI recipients.

### Message To UI Message

```txt
Message.id          -> UI Message.id
Message.text        -> UI Message.content
Message.created_at  -> UI Message.timestamp
Message.is_from_me  -> UI Message.sender === "me"
Message.from_handle -> UI Message.sender for received messages
```

Fallback behavior:

- If `from_handle` is missing for a received message, use the first non-me chat handle.

## Frontend State Variables

These live in `components/app.tsx`.

### `conversations`

```ts
Conversation[]
```

UI-ready chat list after API data is adapted. This is not persisted in `localStorage`.

### `activeConversation`

```ts
string | null
```

Selected `Chat.id`. This value is also the API `:chatId` and browser `?id=` value.

### `lastActiveConversation`

```ts
string | null
```

Last selected `Chat.id`, used when switching from mobile layout back to desktop layout.

### `messageDrafts`

```ts
Record<string, string>
```

Local unsent drafts.

Keys:

- Existing thread: `Chat.id`
- New thread composer: `"new"`

### `recipientInput`

```ts
string
```

Comma-separated recipient input for a new chat. On send, this becomes `CreateChatRequest.handles`.

### `isMobileView`

```ts
boolean
```

Derived after mount from:

```ts
window.innerWidth < 768
```

This controls desktop auto-selection versus mobile list-first behavior.

### `isLoadingChats`

```ts
boolean
```

Controls first-load skeleton UI while chats and messages are loading.

## Store Behavior

The current local backend uses module-level maps:

```ts
const chats = new Map<string, Chat>();
const messagesByChat = new Map<string, Message[]>();
```

Behavior:

- Seed data is adapted from `data/initial-conversations.ts`.
- Data lives in process memory and resets when the Next.js server restarts.
- `listChats()` returns chats sorted by `updated_at` descending.
- `getMessages(chatId)` returns messages sorted by `created_at` ascending.
- `createChat(request)` creates a chat, participant handles, and the first message.
- `sendMessage(chatId, { text, as_me, from_handle? })` creates a message and updates parent chat activity (public `/api/chats/:chatId/messages` only sends `as_me: true` user messages; the internal agent webhook sends agent messages with `as_me: false`).
- `markChatRead(chatId)` sets unread count to zero and marks received messages read.

## Implementation Notes

Preserve these contracts when changing the implementation or replacing the in-memory store:

- Keep route paths stable.
- Keep request DTOs stable unless all frontend call sites are updated together.
- Keep response JSON in `snake_case`.
- Keep `Chat.id` as the only canonical thread id.
- Keep `Message.chat_id` on every message.
- Keep `?id=` synchronized with `Chat.id`.
- Keep chat sorting and message sorting deterministic.
- Keep `POST /api/chats/:chatId/read` idempotent.
- Keep the adapter as the boundary between backend API models and legacy UI types.

Extension guidance:

- Add new backend capabilities through explicit DTO/model changes, then update `lib/chat-adapters.ts` if the UI view model needs the data.
- Do not overload `ChatHandle.id` or `from_handle` as thread identifiers.
- Treat UI-only fields such as `pinned`, `hideAlerts`, reactions, and typing state as presentation concerns until they have explicit backend contracts.
