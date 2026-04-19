# iMessage Agent Starter

Starter repo for building **iMessage-style agents**. Use the React chat UI to develop, see, and test your agent locally—then ship the same frontend against [Linq](https://docs.linqapp.com/) in production without reimplementing chat state, realtime updates, or agent callbacks.

The UI is built against the [Linq OpenAPI spec](https://apidocs.linqapp.com/). Locally, Next.js implements that contract with an in-memory sandbox (`lib/server/store.ts`) so you can iterate without a Linq account. When you're ready to go live, point the app at Linq's API and keep the React interface and agent wiring as-is.

**Local flow:** browser → Next.js (`/api/chats/*`, `/ws`) → optional Python agent (`agent_service/`). See [`docs/chat-api.md`](docs/chat-api.md) for the full API contract.

## What's Included

- **React iMessage interface**: A polished chat UI for testing agent behavior in the same shape users will experience it.
- **Linq-compatible chat contract**: Local API routes mirror the chat, message, and realtime model from Linq's OpenAPI spec, so the UI can move from sandbox to production without a rewrite.
- **Realtime messaging loop**: Next.js serves HTTP chat routes and a `/ws` WebSocket for message, typing, and read-state updates.
- **Agent runtime handoff**: User messages can trigger a Python FastAPI agent, which sends typing and reply events back through Next.js.
- **Tool-ready example agent**: Pepper includes Google Calendar wiring through Composio, showing how external actions can be tested inside the chat UI.

## Run

```bash
pnpm install
pnpm dev
```

`pnpm dev` runs a **custom Node server** (`tsx server.ts`) that serves Next.js and a **`/ws` WebSocket** for realtime chat events. Use this for local development so the UI receives typing and message updates.

```bash
pnpm build
pnpm start   # production: NODE_ENV=production tsx server.ts
```

### Optional agent runtime (Python)

The browser does **not** talk to Python. Next.js calls the agent after a user sends in an agent chat:

1. Start Next: `pnpm dev` (default `http://127.0.0.1:3000`).
2. From `agent_service/`: `uv sync`, then `uv run uvicorn agent_service.main:app --reload --port 8000`.
3. Align env vars on both sides, for example:
   - `AGENT_RUNTIME_URL=http://127.0.0.1:8000` (Next)
   - `NEXT_INTERNAL_BASE_URL=http://127.0.0.1:3000` (Python)
   - `INTERNAL_AGENT_SECRET` — same value in Next and Python (default in code: `dev-internal-agent-secret`)
   - `OPENAI_API_KEY` (Python)
   - `COMPOSIO_API_KEY`, `COMPOSIO_ENABLED=true`, `COMPOSIO_USER_ID` — for Google Calendar via Composio (see [`agent_service/README.md`](agent_service/README.md))

## Implementation Notes

- **Backend**: In-memory Linq-style chat store; API routes call the store directly and `broadcast()` for WebSocket updates.
- **Realtime**: `BrowserEvent` JSON over `ws://<host>/ws` — see `types/realtime.ts`.
- **Agent**: `POST /agent/runs` on the Python service; `agent.message` callbacks to `POST /api/internal/agent/events`.
- **Calendar**: Google Calendar auth and tool execution live in `agent_service/` via Composio MCP; Pepper sends auth links in chat when needed.

_UI inspired by [alanagoyal/messages](https://github.com/alanagoyal/messages)._
