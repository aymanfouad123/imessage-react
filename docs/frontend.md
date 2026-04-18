# Frontend + Realtime Mental Map

This document explains how the app is wired today: UI routes, API route handlers, realtime/WebSocket flow, model transformations, and how the backend side of this repo interacts with the frontend.

It is intentionally separate from `docs/chat-api.md` and is written as an implementation map of the current code.

## 1) Big Picture Architecture

- UI is a Next.js App Router app with one page route (`/`) and a client-heavy chat shell.
- Browser calls Next.js HTTP routes under `/api/chats/*` for CRUD-style chat actions.
- Browser also opens a WebSocket to `/ws` for realtime events (`message.created`, `typing`, `chat.updated`).
- A custom Node entry (`server.ts`) runs Next and attaches a shared WebSocket hub on the same port.
- Chat state is stored in-memory in `lib/server/store.ts` (no database yet).
- Optional Python agent runtime is external to browser traffic: Next calls it, and it posts webhook events back to Next internal route.

## 2) Route Structure (Filesystem + URL)

### Frontend App Routes

App Router files in `app/`:

- `app/layout.tsx` -> root layout for all pages (theme provider + toaster).
- `app/page.tsx` -> `/` (main chat UI mount point).

Current user-visible route surface:

- `/` (single-page chat UI)
  - Uses query param `?id=<chatId>` to represent active thread, not a separate App Router segment.

### API Route Files

All API routes are route-handler files:

- `app/api/chats/route.ts`
  - `GET /api/chats`
  - `POST /api/chats`
- `app/api/chats/[chatId]/route.ts`
  - `GET /api/chats/:chatId`
- `app/api/chats/[chatId]/messages/route.ts`
  - `GET /api/chats/:chatId/messages`
  - `POST /api/chats/:chatId/messages`
- `app/api/chats/[chatId]/read/route.ts`
  - `POST /api/chats/:chatId/read`
- `app/api/internal/agent/events/route.ts`
  - `POST /api/internal/agent/events` (internal webhook endpoint, bearer-auth protected)

### Realtime Endpoint

- `/ws` (WebSocket endpoint attached in `server.ts` + `lib/server/ws-hub.ts`)

## 3) Frontend Entry and Component Topology

### Root Shell

- `app/layout.tsx`
  - Sets global metadata.
  - Wraps app in `ThemeProvider`.
  - Mounts `Toaster` globally.
- `app/page.tsx`
  - Client page that renders `components/app.tsx`.

### Stateful App Coordinator

- `components/app.tsx` is the frontend orchestration layer.
  - Owns local UI state:
    - conversations list, selected conversation, drafts, loading flags
    - mobile/desktop layout toggles
    - search state, command-menu state, sound toggle
    - typing indicator state (`agentTypingConversationId`)
  - Performs all HTTP fetches to `/api/chats/*`.
  - Opens realtime socket via `connectRealtime(...)`.
  - Applies backend/realtime events into local state with merge logic.
  - Converts backend DTOs to UI view models using `lib/chat-adapters.ts`.

### Main UI Composition

Inside `components/app.tsx`:

- `CommandMenu` for keyboard command palette and quick chat selection.
- `Sidebar`
  - shows pinned + regular chat list
  - keyboard and context-menu actions
  - search filtering
  - typing indicators + unread preview behavior
- `ChatArea`
  - `ChatHeader` (recipient editing, new chat setup, contact drawer hooks)
  - `MessageList` (rendered messages + typing row + scroll behavior + sound effects)
  - `MessageInput` (TipTap editor + emoji + mentions + send)

Supporting frontend utility/data files:

- `lib/chat-adapters.ts` -> backend model -> UI model mapping.
- `lib/client/realtime.ts` -> browser WebSocket client with reconnection + dedupe.
- `lib/sound-effects.ts` -> sent/received sound management.
- `lib/contacts.ts` + `data/initial-contacts.ts` -> local contact list helpers.
- `types/index.ts` -> UI-facing `Conversation`, `Message`, `Recipient`.
- `types/realtime.ts` -> websocket event union sent to browser.

## 4) Data Models and Mapping Layers

### Backend Contract Models

Defined in `lib/server/models.ts`:

- `Chat`
  - canonical thread object (`id`, `display_name`, `updated_at`, `unread_count`, `is_agent_chat`, etc.)
- `ChatHandle`
  - participants/handles in a chat (`is_me` distinguishes local user).
- `Message`
  - message record (`chat_id`, `is_from_me`, text + delivery/read timestamps).

DTOs also live here:

- requests: `CreateChatRequest`, `SendMessageRequest`
- responses: `ListChatsResponse`, `ChatResponse`, `MessagesResponse`, `CreateChatResponse`, `SendMessageResponse`, `ReadChatResponse`

### UI View Models

Defined in `types/index.ts`:

- `Conversation`
- `Message`
- `Recipient`

These are UI-optimized and use camelCase + UI-only fields like `pinned`, `hideAlerts`, `isTyping`.

### Adapter Boundary

`lib/chat-adapters.ts` is the translation boundary:

- `toUiConversation({ chat, messages })`
  - maps backend `chat.handles` to UI recipients (non-`is_me` only)
  - maps `chat.unread_count` -> `unreadCount`
  - maps `chat.is_agent_chat` -> `isAgentChat`
- `toUiMessage(message, chat)`
  - maps `is_from_me` to sender `"me"` vs handle name
  - derives UI `status` from `is_read`/`is_delivered` for outgoing messages

Important mental model:

- Backend JSON/contract is source of truth.
- Frontend enriches this for display and interaction ergonomics.

## 5) Backend-in-Repo Runtime Pieces

### Custom Server Bootstrap

- `server.ts`
  - starts Next request handler
  - creates a raw Node HTTP server
  - calls `attachWebSocketHub(server)` so `/ws` works on same host/port
- `package.json` scripts:
  - `pnpm dev` -> `tsx server.ts`
  - `pnpm start` -> production mode same entry

### In-Memory Store

- `lib/server/store.ts` maintains:
  - `Map<string, Chat>` (`chats`)
  - `Map<string, Message[]>` (`messagesByChat`)
- seeded from `data/initial-conversations.ts` on process startup.

Store operations:

- `listChats()` -> sorted by `updated_at desc`
- `getChat(chatId)`
- `getMessages(chatId)` -> sorted by `created_at asc`
- `createChat(request)`
- `sendMessage(chatId, { text, as_me, from_handle? })`
- `markChatRead(chatId)`

### WebSocket Hub

- `lib/server/ws-hub.ts`
  - keeps global `Set<WebSocket>` client list
  - upgrades only when pathname is `/ws`
  - provides `broadcast(event)` to emit serialized `BrowserEvent` to all open clients

## 6) Realtime Contract and Socket Lifecycle

### Browser Event Types

`types/realtime.ts`:

- `message.created`
  - includes `chat`, `message`, and optional `event_id`
- `typing`
  - `state: "started" | "stopped"`
- `chat.updated`
  - includes updated `chat`

### Browser Socket Client

`lib/client/realtime.ts`:

- builds URL from current host:
  - `ws://<host>/ws` or `wss://<host>/ws`
- reconnects with linear backoff:
  - `delay = min(1500 * attempt, 10_000)`
- dedupes events with `event_id` via in-memory `seenIds` set (max 2000)
- exposes `connectRealtime(onEvent, { onOpen })` and returns cleanup/unsubscribe function

### App Realtime Handling

`components/app.tsx`:

- On socket open/reconnect:
  - resets typing indicator
  - on reconnect, reloads chats and messages (`loadChats`)
- On `typing`:
  - toggles `agentTypingConversationId`
  - locally marks latest user message as read when typing starts
- On `message.created`:
  - inserts/merges message into matching conversation
  - if conversation is not present yet, inserts it from the event payload
- On `chat.updated`:
  - updates conversation metadata (name/time/unread count)

## 7) API Routes: File-by-File Behavior

### `app/api/chats/route.ts`

- `GET /api/chats`
  - calls `store.listChats()`
  - returns `{ chats }`
- `POST /api/chats`
  - validates `handles`, `text`, optional `service`, optional `display_name`
  - calls `store.createChat(...)`
  - broadcasts `message.created` for first message
  - returns `{ chat, message }` with `201`

### `app/api/chats/[chatId]/route.ts`

- `GET /api/chats/:chatId`
  - returns chat metadata by id
  - `404` if missing

### `app/api/chats/[chatId]/messages/route.ts`

- `GET /api/chats/:chatId/messages`
  - verifies chat exists
  - returns all messages in that chat
- `POST /api/chats/:chatId/messages`
  - validates `text`
  - creates outgoing user message via `store.sendMessage(... as_me: true)`
  - broadcasts `message.created`
  - if `chat.is_agent_chat`:
    - starts Python agent run via `startAgentRun(...)`
    - logs startup failures server-side
  - returns `{ chat, message }` with `201`

### `app/api/chats/[chatId]/read/route.ts`

- `POST /api/chats/:chatId/read`
  - calls `store.markChatRead(chatId)`
  - broadcasts `chat.updated` (no new message event)
  - returns `{ chat, messages }`

### `app/api/internal/agent/events/route.ts`

- Internal webhook route for Python runtime callbacks.
- Requires `Authorization: Bearer <INTERNAL_AGENT_SECRET>`.
- Accepts:
  - `typing.started`
  - `typing.stopped`
  - `agent.message`
- Behavior:
  - typing events -> broadcasts browser `typing` event
  - `agent.message` -> writes non-me message into store, then broadcasts `message.created`

## 8) Frontend Request/Interaction Flows

### Initial App Load

1. `components/app.tsx` mounts.
2. `loadChats()` -> `GET /api/chats`.
3. For each chat, loads messages via `GET /api/chats/:id/messages`.
4. Chooses active chat based on URL `?id=...` or first chat (desktop behavior).
5. Opens `/ws` socket and resyncs on open/reopen.

### Opening a Conversation

1. UI sets `activeConversation`.
2. URL updated with `?id=<chatId>`.
3. Renders messages already loaded by `loadChats()`.
4. Marks read:
   - `POST /api/chats/:chatId/read`
5. `chat.updated` broadcast arrives and keeps all clients in sync.

### Sending Message to Existing Chat

1. `MessageInput` -> `onSendMessage`.
2. `POST /api/chats/:chatId/messages` with `{ text }`.
3. Response updates local conversation immediately.
4. Same action also emits `message.created` over socket for connected clients.
5. If agent chat, route attempts `startAgentRun`.

### Creating New Chat + First Message

1. User enters recipients in `ChatHeader`.
2. First send triggers `POST /api/chats` with:
   - `handles`
   - `text`
3. Response adds new conversation to local state.
4. Route broadcasts `message.created`.
5. URL switched to `?id=<newChatId>`.

### Agent Response Flow

1. User sends in agent chat.
2. Next route calls Python runtime: `POST {AGENT_RUNTIME_URL}/agent/runs`.
3. Python runtime callbacks:
   - `typing.started` -> Next internal route -> WS `typing`
   - `agent.message` -> Next internal route -> `store.sendMessage(as_me:false)` -> WS `message.created`
   - `typing.stopped` -> WS `typing`
4. Frontend updates typing row + incoming message in realtime.

## 9) URL and Identifier Conventions

- Canonical thread id is backend `Chat.id`.
- Dynamic API segment `[chatId]` always maps to `Chat.id`.
- Frontend query param `?id=` is also `Chat.id`.
- Message ownership is `Message.chat_id === Chat.id`.

## 10) Persistence, Scope, and Current Constraints

- Persistence is process-local in-memory only (`store.ts`).
- Restarting server resets to seed data (`data/initial-conversations.ts`) plus runtime changes are lost.
- Delete/pin/mute actions in parts of UI are currently frontend behavior stubs or local-only updates for this milestone.
- Browser never calls Python directly; all agent orchestration is server-to-server via Next.

## 11) Quick File Index (What to Open for What)

- Route map and handlers:
  - `app/api/chats/route.ts`
  - `app/api/chats/[chatId]/route.ts`
  - `app/api/chats/[chatId]/messages/route.ts`
  - `app/api/chats/[chatId]/read/route.ts`
  - `app/api/internal/agent/events/route.ts`
- Runtime wiring:
  - `server.ts`
  - `lib/server/ws-hub.ts`
  - `lib/client/realtime.ts`
- Data and contract:
  - `lib/server/models.ts`
  - `lib/server/store.ts`
  - `lib/chat-adapters.ts`
  - `types/index.ts`
  - `types/realtime.ts`
- Frontend orchestrator + UI:
  - `app/page.tsx`
  - `components/app.tsx`
  - `components/sidebar.tsx`
  - `components/chat-area.tsx`
  - `components/message-list.tsx`
  - `components/message-input.tsx`
  - `components/chat-header.tsx`
- Seed and demo fixtures:
  - `data/initial-conversations.ts`
  - `data/initial-contacts.ts`

---

If you want, this can be followed by a second companion doc that is sequence-diagram heavy (request/event timeline diagrams for each user action).
