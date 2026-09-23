// WebSocket subscription for the agent's JSON event streams, on the shared
// fixed-cadence reconnect loop.
//
// The pairing key is exchanged for a one-shot ticket carried as a WS
// subprotocol value; that exchange lives in ``./ws-ticket`` and is
// shared with the MAVLink bridge so both dial the agent's gated WS
// handlers the same way.

import { openReconnectingSocket } from "@/lib/net/reconnecting-socket";
import type { RequestContext } from "./request";
import {
  WS_TICKET_PROTOCOL,
  mintWsTicket,
  type WsAuthScope,
} from "./ws-ticket";

export type { WsAuthScope } from "./ws-ticket";

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
  // No ``?api_key=`` query param. The pairing key never reaches the URL.
  const url = ctx.baseUrl.replace(/^http/, "ws") + path;

  return openReconnectingSocket({
    // Every dial mints a fresh ticket: a ticket is consumed by one handshake.
    open: async (signal) => {
      const ticket = await mintWsTicket(ctx, scope, signal);
      return ticket ? new WebSocket(url, [WS_TICKET_PROTOCOL, ticket]) : new WebSocket(url);
    },
    onMessage: (data) => {
      try {
        onEvent(JSON.parse(String(data)) as E);
      } catch {
        // ignore malformed frames
      }
    },
    // The first dial is not a state these streams report.
    onState: (state) => {
      if (state !== "connecting") onState?.(state);
    },
    terminalCloseCodes: [CLOSE_POLICY_VIOLATION],
  });
}
