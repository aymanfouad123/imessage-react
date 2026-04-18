import type { BrowserEvent } from "@/types/realtime";

const MAX_DEDUPE = 2000;
const seenIds = new Set<string>();

function rememberId(id: string): boolean {
  if (seenIds.has(id)) return false;
  seenIds.add(id);
  if (seenIds.size > MAX_DEDUPE) {
    const first = seenIds.values().next().value as string | undefined;
    if (first !== undefined) seenIds.delete(first);
  }
  return true;
}

/**
 * Subscribes to Next.js WebSocket hub (`/ws`). Reconnects with backoff on close.
 */
export function connectRealtime(
  onEvent: (event: BrowserEvent) => void,
  options: {
    onOpen?: (state: { isReconnect: boolean }) => void | Promise<void>;
  } = {}
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${scheme}://${window.location.host}/ws`;
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: number | undefined;
  let attempt = 0;
  let hasOpened = false;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(url);

    ws.onopen = () => {
      const isReconnect = hasOpened;
      hasOpened = true;
      attempt = 0;
      void Promise.resolve(options.onOpen?.({ isReconnect })).catch(() => {
        /* resync failures are handled by the app */
      });
    };

    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data as string) as BrowserEvent;
        if (data.event_id !== undefined && data.event_id !== "") {
          if (!rememberId(data.event_id)) return;
        }
        onEvent(data);
      } catch {
        /* ignore malformed */
      }
    };

    ws.onclose = () => {
      if (closed) return;
      attempt += 1;
      const delay = Math.min(1500 * attempt, 10_000);
      reconnectTimer = window.setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws?.close();
    };
  };

  connect();

  return () => {
    closed = true;
    window.clearTimeout(reconnectTimer);
    ws?.close();
  };
}
