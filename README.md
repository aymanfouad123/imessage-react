# iMessage Mock

Local iMessage-style UI mock built with Next.js and Tailwind.

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

The browser does **not** talk to Python. Next.js calls the agent after user sends in an agent chat:

1. Start Next: `pnpm dev` (default `http://127.0.0.1:3000`).
2. From `agent_service/`, run the FastAPI app (e.g. `uv run uvicorn agent_service.main:app --reload --port 8000`).
3. Align env vars on both sides, for example:
   - `AGENT_RUNTIME_URL=http://127.0.0.1:8000` (Next)
   - `NEXT_INTERNAL_BASE_URL=http://127.0.0.1:3000` (Python)
   - `INTERNAL_AGENT_SECRET` — same value in Next and Python (default in code: `dev-internal-agent-secret`)

## Notes

- **Backend**: In-memory chat store (`lib/server/store.ts`); API routes call the store directly and `broadcast()` for WebSocket updates.
- **Realtime**: `BrowserEvent` JSON over `ws://<host>/ws` — see `types/realtime.ts`.
- **Agent**: `POST /agent/runs` on the Python service; `agent.message` callbacks to `POST /api/internal/agent/events`.
- `pnpm build` passes.
- Chat sandbox system context lives in [`docs/chat-api.md`](docs/chat-api.md).

## Credits

UI assets and inspiration come from [alanagoyal/messages](https://github.com/alanagoyal/messages)—thanks to Alana Goyal for the original iMessage-inspired project that made this much easier to build on.
