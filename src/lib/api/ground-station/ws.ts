// WebSocket subscription for the agent's JSON event streams, on the shared
// fixed-cadence reconnect loop.
//
// The pairing key is exchanged for a one-shot ticket carried as a WS
// subprotocol value; that exchange lives in ``./ws-ticket`` and is
// shared with the MAVLink bridge so both dial the agent's gated WS
// handlers the same way.

import { SOCKET_LIVENESS_TIMEOUT_MS, openReconnectingSocket } from "@/lib/net/reconnecting-socket";
import type { RequestContext } from "./request";
import {
  WS_TICKET_PROTOCOL,
  mintWsTicket,
  type WsAuthScope,
} from "./ws-ticket";

export type { WsAuthScope } from "./ws-ticket";

/** Policy-violation close: the agent's handler refuses this node's profile
 *  (`E_PROFILE_MISMATCH`). The profile can change in setup, so the stream is
 *  redialled on the loop's slower fixed cadence rather than abandoned. */
const CLOSE_POLICY_VIOLATION = 1008;

export interface SubscribeOptions<E> {
  ctx: RequestContext;
  path: string;
  /** Scope tag the ticket-mint endpoint should stamp the ticket with.
   *  The agent's WS handler validates the same scope on consume. */
  scope: WsAuthScope;
  onEvent: (event: E) => void;
  /** `closed` is reported only after the returned teardown runs; a refused
   *  or silent stream reports `reconnecting` while it keeps retrying. */
  onState?: (state: "connected" | "reconnecting" | "closed") => void;
  /** The handler sends a `{kind:"keepalive"}` frame every few seconds, so a
   *  socket silent past the liveness timeout is dead and is redialled. True
   *  for the ground-station event streams; false for a stream that can go
   *  quiet while healthy. Default true. */
  peerSendsKeepalive?: boolean;
}

export function subscribeWebSocket<E>(opts: SubscribeOptions<E>): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }
  const { ctx, path, scope, onEvent, onState, peerSendsKeepalive = true } = opts;
  // No ``?api_key=`` query param. The pairing key never reaches the URL.
  const url = ctx.baseUrl.replace(/^http/, "ws") + path;

  return openReconnectingSocket({
    livenessTimeoutMs: peerSendsKeepalive ? SOCKET_LIVENESS_TIMEOUT_MS : undefined,
    // Every dial mints a fresh ticket: a ticket is consumed by one handshake.
    open: async (signal) => {
      const ticket = await mintWsTicket(ctx, scope, signal);
      return ticket ? new WebSocket(url, [WS_TICKET_PROTOCOL, ticket]) : new WebSocket(url);
    },
    onMessage: (data) => {
      let frame: unknown;
      try {
        frame = JSON.parse(String(data));
      } catch {
        return; // ignore malformed frames
      }
      // The agent's `{kind:"keepalive"}` frame feeds the loop's liveness
      // timer and is not an event.
      if (typeof frame === "object" && frame !== null && "kind" in frame && frame.kind === "keepalive") {
        return;
      }
      onEvent(frame as E);
    },
    // The first dial is not a state these streams report.
    onState: (state) => {
      if (state !== "connecting") onState?.(state);
    },
    slowRetryCloseCodes: [CLOSE_POLICY_VIOLATION],
  });
}
