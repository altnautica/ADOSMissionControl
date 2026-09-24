/**
 * @module agent/agent-client/timeout
 * @description Abort-based fetch deadlines shared across the agent REST
 * surface. A half-open TCP socket (the peer vanished without an RST)
 * keeps an `await fetch` pending for the browser default (~300 s in
 * Chromium), which defeats the disconnect watchdog and stalls the tier
 * cascade. Every agent fetch carries a deadline so a silent host raises
 * an abort the caller can act on instead of hanging.
 * @license GPL-3.0-only
 */

/** Default per-request deadline for agent reads. Comfortably above the
 * 3 s poll cadence so a healthy-but-loaded agent's multi-endpoint poll
 * still completes, and well under the browser's multi-minute hang so the
 * staleness cascade fires within a couple of poll cycles. */
export const AGENT_FETCH_TIMEOUT_MS = 6000;

/** Upstream deadline for an agent write that restarts one of its services
 * before answering (the active vision detector): the agent allows
 * `systemctl restart` 30 s and then confirms the restart for up to ~5 s. */
export const AGENT_SERVICE_RESTART_TIMEOUT_MS = 40_000;

/** Browser-side deadline for the same write: the upstream deadline plus a
 * margin for the Mission Control proxy hop in front of it. */
export const AGENT_SERVICE_RESTART_CLIENT_TIMEOUT_MS = AGENT_SERVICE_RESTART_TIMEOUT_MS + 5_000;

/** Combine a caller-supplied signal with a fresh timeout signal. The
 * result aborts when either fires. Falls back to manual fan-in when the
 * runtime lacks `AbortSignal.any`. */
export function withTimeoutSignal(
  timeoutMs: number = AGENT_FETCH_TIMEOUT_MS,
  caller?: AbortSignal | null,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!caller) return timeout;
  if (caller.aborted) return caller;
  if ("any" in AbortSignal && typeof AbortSignal.any === "function") {
    return AbortSignal.any([caller, timeout]);
  }
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  caller.addEventListener("abort", onAbort, { once: true });
  timeout.addEventListener("abort", onAbort, { once: true });
  return ctrl.signal;
}

/** `fetch` with a deadline. Any caller-supplied `signal` is honoured in
 * addition to the timeout. */
export function timedFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number = AGENT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: withTimeoutSignal(timeoutMs, init?.signal ?? null),
  });
}
