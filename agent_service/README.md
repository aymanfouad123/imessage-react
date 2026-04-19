# Agent Service

FastAPI **agent runtime** (reasoning + formatting). It does **not** own persistence or browser realtime. Next.js is the carrier: it stores chat state, serves the UI, and accepts webhooks from this service.

## Start a run

`POST /agent/runs` — body:

```json
{
  "run_id": "uuid-from-next",
  "chat_id": "thread-id",
  "trigger": { "reason": "user_message", "message_id": "last-user-message-id" },
  "context": {
    "recent_messages": [/* Sandbox-shaped messages, snake_case */],
    "agent_handle": "Pepper"
  }
}
```

Returns `202` with `{ "run_id": "..." }`. Work continues in a background task.

## Callbacks to Next

All traffic goes to Next (never to public `/api/chats/*`):

- `POST {NEXT_INTERNAL_BASE_URL}/api/internal/agent/events`
- Header: `Authorization: Bearer {INTERNAL_AGENT_SECRET}`

Event shapes (JSON):

- `{ "kind": "typing.started", "run_id", "chat_id" }`
- `{ "kind": "typing.stopped", "run_id", "chat_id" }`
- `{ "kind": "agent.message", "run_id", "chat_id", "text", "sender_handle" }`

Next persists the message in its in-memory store and pushes realtime events to the browser. The runtime uses the `recent_messages` snapshot supplied in `/agent/runs`; it does not re-fetch chat context from Next before sending.

## Run

From this directory:

```bash
uv sync
uv run uvicorn agent_service.main:app --reload --port 8000
```

Configure `NEXT_INTERNAL_BASE_URL`, `INTERNAL_AGENT_SECRET`, and model keys in `.env` as needed.

## Google Calendar (Composio)

The agent can handle calendar requests via Composio MCP meta tools. Composio stays inside this service; the browser never talks to Composio directly.

### Environment

Create `agent_service/.env` (or export):

```bash
OPENAI_API_KEY=...
COMPOSIO_API_KEY=...          # from Composio dashboard
COMPOSIO_ENABLED=true
COMPOSIO_USER_ID=user_xgge7l  # stable per-user id for your demo
COMPOSIO_REQUIRED_TOOLKITS=googlecalendar
COMPOSIO_MANAGE_CONNECTIONS=true
AGENT_READ_DELAY_SECONDS=1.25
NEXT_INTERNAL_BASE_URL=http://127.0.0.1:3000
INTERNAL_AGENT_SECRET=dev-internal-agent-secret
```

### Flow

1. User sends a calendar-intent message in the Pepper agent chat (e.g. "schedule coffee tomorrow at 2pm").
2. Orchestrator waits briefly to simulate Pepper reading the message, then starts typing.
3. Orchestrator detects calendar intent via lightweight keyword matching.
4. If Google Calendar is **not connected**, Pepper replies with a Composio auth link.
5. User connects Google Calendar, then sends the request again.
6. If connected, the reasoner runs with Composio hosted MCP tools and summarizes the result in a normal chat reply.

### Demo prompts

- Normal chat: `hey pepper, how's it going?`
- Auth needed: `what's on my calendar this week?` (before connecting)
- Connected: `schedule coffee with Alex tomorrow at 2pm`
- Connected: `am I free Friday afternoon?`

