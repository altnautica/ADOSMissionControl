// Pilot In Command arbiter: claim, release, heartbeat, confirm tokens, and the PIC event stream.

import type {
  PicClaimResult,
  PicConfirmTokenResult,
  PicEvent,
  PicReleaseResult,
  PicState,
} from "./types";
import {
  gsRequest,
  GroundStationApiError,
  GS_FETCH_TIMEOUT_MS,
  type RequestContext,
} from "./request";
import { timedFetch } from "@/lib/agent/agent-client/timeout";
import { subscribeWebSocket } from "./ws";

export function getPicState(ctx: RequestContext): Promise<PicState> {
  return gsRequest<PicState>(ctx, "/api/v1/ground-station/pic");
}

export function claimPic(
  ctx: RequestContext,
  clientId: string,
  confirmToken?: string,
  force?: boolean,
): Promise<PicClaimResult> {
  const body: Record<string, unknown> = { client_id: clientId };
  if (confirmToken) body.confirm_token = confirmToken;
  if (force) body.force = true;
  return gsRequest<PicClaimResult>(ctx, "/api/v1/ground-station/pic/claim", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function releasePic(
  ctx: RequestContext,
  clientId: string,
): Promise<PicReleaseResult> {
  return gsRequest<PicReleaseResult>(
    ctx,
    "/api/v1/ground-station/pic/release",
    {
      method: "POST",
      body: JSON.stringify({ client_id: clientId }),
    },
  );
}

/**
 * Heartbeat the current PIC claim. Called at 10 s interval by the holding
 * client to prove liveness. The agent auto-releases claims whose last
 * heartbeat is older than its grace window.
 *
 * Returns { ok: true } on 200, or { ok: false, orphaned: true } on 410
 * (claim already auto-released by the agent). Other non-2xx responses
 * throw GroundStationApiError as usual.
 */
export async function heartbeatPic(
  ctx: RequestContext,
  clientId: string,
): Promise<{ ok: true } | { ok: false; orphaned: true }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (ctx.apiKey) headers["X-ADOS-Key"] = ctx.apiKey;
  // Bypasses `gsRequest` (it needs the 410 branch), so it carries its own
  // deadline. Unbounded, a stalled heartbeat stacked up: `pollPicHeartbeat`
  // fires it from a 10 s interval, so six stalls exhausted Chromium's
  // 6-socket HTTP/1.1 pool for the origin in a minute and every other
  // ground-station request queued behind them.
  const res = await timedFetch(
    `${ctx.baseUrl}/api/v1/ground-station/pic/heartbeat`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ client_id: clientId }),
    },
    GS_FETCH_TIMEOUT_MS,
  );
  if (res.status === 410) return { ok: false, orphaned: true };
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new GroundStationApiError(res.status, text);
  }
  // Body is best-effort; success is the 200 itself.
  await res.json().catch(() => undefined);
  return { ok: true };
}

export function createPicConfirmToken(
  ctx: RequestContext,
  clientId: string,
): Promise<PicConfirmTokenResult> {
  return gsRequest<PicConfirmTokenResult>(
    ctx,
    "/api/v1/ground-station/pic/confirm-token",
    {
      method: "POST",
      body: JSON.stringify({ client_id: clientId }),
    },
  );
}

/**
 * Subscribe to PIC events via WebSocket.
 * Returns an unsubscribe function that closes the socket.
 * Reconnects automatically with exponential backoff on close.
 */
export function subscribePicEvents(
  ctx: RequestContext,
  onEvent: (e: PicEvent) => void,
): () => void {
  return subscribeWebSocket<PicEvent>({
    ctx,
    path: "/api/v1/ground-station/pic/events",
    scope: "gs.pic_events",
    onEvent,
  });
}
