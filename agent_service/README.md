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
