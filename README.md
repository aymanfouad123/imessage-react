# iMessage Mock

Local iMessage-style UI mock built with Next.js and Tailwind.

## Run

```bash
pnpm install
pnpm dev
```

## Notes

- The app is now client-only for chat behavior.
- The optional FastAPI agent service streams message-shaped SSE progress for staged sends.
- Agent stream events append complete messages; they do not render token deltas or growing message text.
- `pnpm build` passes.
- Chat sandbox system context lives in [`docs/chat-api.md`](docs/chat-api.md).

## Credits

UI assets and inspiration come from [alanagoyal/messages](https://github.com/alanagoyal/messages)—thanks to Alana Goyal for the original iMessage-inspired project that made this much easier to build on.
