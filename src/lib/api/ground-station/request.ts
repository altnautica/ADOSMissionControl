// HTTP request context, error class, and shared fetch helper for ground station API modules.
//
// Every request carries a DEADLINE. `gsRequest` is the shared helper behind
// ~60 call sites across fleet / mesh / network / peripherals / pic / status /
// ui / wfb — including PIC claim and release, mesh role transitions
// and WFB pair/unpair — and it called `fetch` with no `signal` at all. On a
// half-open socket (the peer vanished without an RST) each one awaited the
// browser default, ~300 s in Chromium, so a handful of stalled requests
// exhausted the 6-connection HTTP/1.1 pool for the origin and every other
// ground-station call queued behind them. The agent-side client already
// solved this; this is the same helper.

import { timedFetch } from "@/lib/agent/agent-client/timeout";

/**
 * Per-request deadline for ground-station REST calls.
 *
 * Longer than the agent default because some of these are genuine
 * state-changing operations (a WFB pair, a mesh role transition) rather than
 * a status poll, and still far under the browser's multi-minute hang.
 */
export const GS_FETCH_TIMEOUT_MS = 15000;

export class GroundStationApiError extends Error {
  public readonly status: number;
  public readonly body: string;

  constructor(status: number, body: string, message?: string) {
    super(message ?? `Ground station API ${status}: ${body}`);
    this.status = status;
    this.body = body;
    this.name = "GroundStationApiError";
  }
}

export interface RequestContext {
  baseUrl: string;
  apiKey: string | null;
}

export async function gsRequest<T>(
  ctx: RequestContext,
  path: string,
  init?: RequestInit,
  timeoutMs: number = GS_FETCH_TIMEOUT_MS,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init?.headers as Record<string, string>),
  };
  if (ctx.apiKey) {
    headers["X-ADOS-Key"] = ctx.apiKey;
  }
  const res = await timedFetch(
    `${ctx.baseUrl}${path}`,
    { ...init, headers },
    timeoutMs,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new GroundStationApiError(res.status, text);
  }
  return res.json() as Promise<T>;
}
