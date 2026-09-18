// One-shot WebSocket ticket mint, shared by every authenticated WS dial.
//
// Browsers cannot set ``X-ADOS-Key`` on a WebSocket handshake, so the
// pairing key cannot ride a request header. Instead we exchange the
// pairing key (via the normal ``X-ADOS-Key`` REST middleware) for a
// one-shot ticket at ``POST /api/_ws/ticket`` and hand the ticket to
// ``new WebSocket(url, ["ados-ws-ticket", ticket])`` so it rides the
// subprotocol header instead of the URL. URLs end up in DevTools, HAR
// exports, and reverse-proxy access logs; the ticket does not.

import { GS_FETCH_TIMEOUT_MS, type RequestContext } from "./request";
import { timedFetch } from "@/lib/agent/agent-client/timeout";

/** Subprotocol marker the agent expects as the first entry when a
 *  browser presents a one-shot ticket. The agent echoes this exact
 *  value back in ``websocket.accept(subprotocol=...)`` per RFC 6455. */
export const WS_TICKET_PROTOCOL = "ados-ws-ticket";

/** Scope strings the agent accepts at the ticket-mint endpoint. Keep
 *  in sync with ``ALLOWED_SCOPES`` in the agent's ws-ticket route. */
export type WsAuthScope =
  | "setup.cloudflare_logs"
  | "gs.pic_events"
  | "gs.mavlink_ws"
  | "gs.uplink_events"
  | "gs.mesh_events"
  | "vision.detections";

interface TicketMintResponse {
  ok: boolean;
  ticket: string;
  scope: string;
  expires_at: number;
}

/**
 * Exchange the pairing key for a one-shot WS ticket scoped to ``scope``.
 *
 * Returns ``null`` when the context carries no pairing key: an unpaired
 * agent takes an open posture on its WS handlers, so the handshake
 * succeeds without a ticket and the caller dials with no subprotocol.
 *
 * Throws on a non-OK mint response or a malformed body so the caller
 * can fall through to a legacy / relayed path.
 */
export async function mintWsTicket(
  ctx: RequestContext,
  scope: WsAuthScope,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!ctx.apiKey) {
    return null;
  }
  const url = `${ctx.baseUrl.replace(/\/$/, "")}/api/_ws/ticket`;
  // A ticket mint gates the WebSocket dial behind it, so an unbounded one
  // wedges the whole relayed-MAVLink bring-up: `signal` is optional and
  // both call sites pass nothing, leaving the browser default (~300 s).
  const res = await timedFetch(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-ADOS-Key": ctx.apiKey,
      },
      body: JSON.stringify({ scope }),
      signal,
    },
    GS_FETCH_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`ticket mint failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as TicketMintResponse;
  if (!body.ticket) {
    throw new Error("ticket mint response missing ticket");
  }
  return body.ticket;
}
