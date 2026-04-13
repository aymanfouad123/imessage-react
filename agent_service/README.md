# Agent Service

FastAPI service that drives the local iMessage-style agent experience.

## Runtime Stream

`POST /agent/respond/stream` returns server-sent events. SSE is used for
runtime progress and staged sends, not token-by-token rendering.

Runtime event types:

- `typing.started`
- `message.persisted`
- `message.delivered`
- `message.read`
- `task.started`
- `task.update`
- `task.completed`
- `run.completed`
- `error`

`message.persisted` is the UI insertion point. It carries `message_id`, `text`,
and the persisted sandbox message in `payload`. Formatter chunks are sent as
separate messages; the frontend should append complete messages and must not
grow an existing message from partial text instructions.

`typing.started` indicates the agent is preparing the next staged send. It does
not reserve or identify a future message.

## Non-Streaming Response

`POST /agent/respond` returns:

```json
{
  "chat_id": "chat-id",
  "status": "replied",
  "messages": ["first staged send", "second staged send"],
  "message_ids": ["message-id-1", "message-id-2"],
  "reason": null
}
```

Skipped runs return `status: "skipped"`, empty `messages` and `message_ids`,
and a `reason` when available.

## Reply Decision

The orchestrator decides from recent thread memory, the latest user message,
and whether the agent has already replied to that user turn. Read receipts and
delivery realism belong to the sandbox layer, not the Python reply gate.
