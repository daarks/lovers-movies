import { useEffect, useRef, useState } from "react";
import { appUrl } from "../lib/appBase";

export type SwipeConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

export type VoteSSEEvent = {
  type: "vote";
  profile: "a" | "b";
  item_id: number;
  tmdb_id: number;
  media_type: string;
  new_state: string;
  cursor_a: number;
  cursor_b: number;
};

export type MatchSSEEvent = {
  type: "match";
  item_id: number;
  tmdb_id: number;
  media_type?: string;
  title: string;
  poster_path?: string | null;
};

export type PresenceSSEEvent = {
  type: "presence";
  online: { a: boolean; b: boolean };
};

export type HeartbeatSSEEvent = { type: "heartbeat" };
export type ConnectedSSEEvent = { type: "connected"; profile: string };

export type SwipeSSEEvent =
  | VoteSSEEvent
  | MatchSSEEvent
  | PresenceSSEEvent
  | HeartbeatSSEEvent
  | ConnectedSSEEvent;

function parseEvent(raw: string): SwipeSSEEvent | null {
  try {
    const j = JSON.parse(raw) as SwipeSSEEvent;
    if (j && typeof j === "object" && "type" in j) return j;
  } catch {
    /* ignore */
  }
  return null;
}

export function useSwipeStream(
  sessionId: string | null,
  currentProfile: "a" | "b",
  options?: { onResync?: () => void | Promise<void> }
) {
  const [connected, setConnected] = useState(false);
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [lastEvent, setLastEvent] = useState<SwipeSSEEvent | null>(null);
  const [connectionState, setConnectionState] = useState<SwipeConnectionState>("offline");
  const onResyncRef = useRef<(() => void | Promise<void>) | undefined>(undefined);
  onResyncRef.current = options?.onResync;

  const partnerSlug: "a" | "b" = currentProfile === "a" ? "b" : "a";

  useEffect(() => {
    if (!sessionId) {
      setConnected(false);
      setConnectionState("offline");
      setPartnerOnline(false);
      return undefined;
    }

    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectAttempt = 0;
    let backoffTimer: number | null = null;

    const clearBackoff = () => {
      if (backoffTimer != null) {
        window.clearTimeout(backoffTimer);
        backoffTimer = null;
      }
    };

    const applyPresence = (online: { a?: boolean; b?: boolean } | undefined) => {
      if (!online) return;
      setPartnerOnline(Boolean(online[partnerSlug]));
    };

    const open = () => {
      if (cancelled) return;
      clearBackoff();
      const attempt = reconnectAttempt;
      setConnectionState(attempt > 0 ? "reconnecting" : "connecting");
      const url = appUrl(
        `/api/swipe/stream/${encodeURIComponent(sessionId)}?profile=${encodeURIComponent(currentProfile)}`
      );
      es = new EventSource(url);

      es.onopen = () => {
        if (cancelled) return;
        const wasReconnect = reconnectAttempt > 0;
        reconnectAttempt = 0;
        setConnected(true);
        setConnectionState("connected");
        const fn = onResyncRef.current;
        if (fn && wasReconnect) void Promise.resolve(fn());
      };

      es.onmessage = (ev) => {
        if (cancelled) return;
        const msg = parseEvent(ev.data);
        if (!msg) return;
        if (msg.type === "heartbeat") {
          return;
        }
        setLastEvent(msg);
        if (msg.type === "presence") applyPresence(msg.online);
      };

      es.onerror = () => {
        if (cancelled) return;
        setConnected(false);
        try {
          es?.close();
        } catch {
          /* ignore */
        }
        es = null;
        reconnectAttempt += 1;
        setConnectionState("reconnecting");
        const n = reconnectAttempt;
        const delayMs = Math.min(30000, 1000 * 2 ** Math.min(n - 1, 5));
        backoffTimer = window.setTimeout(() => {
          backoffTimer = null;
          open();
        }, delayMs);
      };
    };

    reconnectAttempt = 0;
    open();

    return () => {
      cancelled = true;
      clearBackoff();
      try {
        es?.close();
      } catch {
        /* ignore */
      }
      setConnected(false);
      setConnectionState("offline");
    };
  }, [sessionId, currentProfile]);

  return { connected, partnerOnline, lastEvent, connectionState, partnerSlug };
}
