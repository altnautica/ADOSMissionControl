// WebSocket subscription helper with a fixed-cadence reconnect, used by event streams.
//
// The pairing key is exchanged for a one-shot ticket carried as a WS
// subprotocol value; that exchange lives in ``./ws-ticket`` and is
// shared with the MAVLink bridge so both dial the agent's gated WS
// handlers the same way.

import type { RequestContext } from "./request";
import {
  WS_TICKET_PROTOCOL,
  mintWsTicket,
  type WsAuthScope,
} from "./ws-ticket";

export type { WsAuthScope } from "./ws-ticket";

/** Fixed retry cadence. Constant rather than growing, and never reset by an
 *  open that the agent immediately closes, so a refusing or flapping handler
 *  costs one ticket mint and one handshake every few seconds, not a storm. */
const RECONNECT_MS = 3000;

/** Policy-violation close: the agent's handler refuses this node's profile
 *  (`E_PROFILE_MISMATCH`). Retrying cannot change the answer. */
const CLOSE_POLICY_VIOLATION = 1008;

export interface SubscribeOptions<E> {
  ctx: RequestContext;
  path: string;
  /** Scope tag the ticket-mint endpoint should stamp the ticket with.
   *  The agent's WS handler validates the same scope on consume. */
  scope: WsAuthScope;
  onEvent: (event: E) => void;
  /** `closed` is also reported when the agent refuses the stream for this
   *  node's profile (close 1008); the subscription stops retrying then. */
  onState?: (state: "connected" | "reconnecting" | "closed") => void;
}

export function subscribeWebSocket<E>(opts: SubscribeOptions<E>): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const { ctx, path, scope, onEvent, onState } = opts;
  const httpBase = ctx.baseUrl;
  const wsBase = httpBase.replace(/^http/, "ws");
  // No ``?api_key=`` query param. The pairing key never reaches the URL.
  const url = wsBase + path;

  let closed = false;
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let lastReportedState: "connected" | "reconnecting" | "closed" | null = null;
  let mintAbort: AbortController | null = null;

  const reportState = (s: "connected" | "reconnecting" | "closed") => {
    if (lastReportedState === s) return;
    lastReportedState = s;
    try {
      onState?.(s);
    } catch {
      // never propagate a consumer error back into the socket loop
    }
  };

  const connect = async () => {
    if (closed) return;
    let ticket: string | null;
    try {
      mintAbort = new AbortController();
      ticket = await mintWsTicket(ctx, scope, mintAbort.signal);
    } catch (err) {
      void err;
      if (closed) return;
      reportState("reconnecting");
      scheduleReconnect();
      return;
    }
    if (closed) return;
    try {
      ws = ticket
        ? new WebSocket(url, [WS_TICKET_PROTOCOL, ticket])
        : new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      reportState("connected");
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data)) as E;
        onEvent(data);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onerror = () => {
      // onclose handles reconnection
    };
    ws.onclose = (ev: CloseEvent) => {
      ws = null;
      if (closed) return;
      if (ev.code === CLOSE_POLICY_VIOLATION) {
        closed = true;
        reportState("closed");
        return;
      }
      reportState("reconnecting");
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (closed) return;
      void connect();
    }, RECONNECT_MS);
  };

  void connect();

  return () => {
    closed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (mintAbort) {
      try {
        mintAbort.abort();
      } catch {
        // ignore
      }
      mintAbort = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
      ws = null;
    }
    reportState("closed");
  };
}
