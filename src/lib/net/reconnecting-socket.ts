/**
 * @module net/reconnecting-socket
 * @description The one reconnect loop every long-lived WebSocket stream
 * uses. The retry delay is fixed and never grows, and an open that the peer
 * closes at once never shortens it, so a refusing or flapping handler costs
 * one dial every few seconds rather than a storm, while a peer that is not up
 * yet is still noticed within one delay of coming up. The loop never gives up
 * on its own: a dial that does not open within the connect deadline, and
 * (for a stream with a liveness timeout) an open socket that goes quiet past
 * it, a peer that vanished without a FIN, are both dropped and redialled.
 * Close codes that mean "not now" rather than "broken" retry on a slower
 * fixed cadence.
 * @license GPL-3.0-only
 */

/** Fixed delay between a failed or closed socket and the next dial. */
export const SOCKET_RETRY_MS = 3000;
/** Fixed delay after a close code listed in `slowRetryCloseCodes`. */
export const SOCKET_SLOW_RETRY_MS = 5000;
/** A dial (including an async `open`) that has not opened by now is dropped. */
export const SOCKET_CONNECT_DEADLINE_MS = 5000;
/**
 * An open socket that delivers no frame for this long is treated as dead.
 * A stream whose peer sends a keepalive frame well inside it passes this as
 * `livenessTimeoutMs`.
 */
export const SOCKET_LIVENESS_TIMEOUT_MS = 15000;

/** The subset of `WebSocket` the loop drives, so a test can inject one. */
export interface ReconnectingSocketLike {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close: () => void;
}

/** `connecting` before the first dial, `reconnecting` while retrying,
 * `closed` only after teardown. Repeats are collapsed. */
export type ReconnectingSocketState = "connecting" | "connected" | "reconnecting" | "closed";

export interface ReconnectingSocketOptions<S extends ReconnectingSocketLike> {
  /** Dial one socket. A throw or rejection counts as a failed attempt. The
   * signal aborts when the attempt is abandoned or the loop is torn down. */
  open: (signal: AbortSignal) => S | Promise<S>;
  /** One frame's payload, exactly as the socket delivered it. */
  onMessage: (data: unknown) => void;
  onState?: (state: ReconnectingSocketState) => void;
  /** Close codes after which the peer may answer differently later (for
   * example a profile refusal that a setup change lifts): retried on
   * {@link SOCKET_SLOW_RETRY_MS} instead of {@link SOCKET_RETRY_MS}. */
  slowRetryCloseCodes?: readonly number[];
  /** Drop and redial an open socket that delivers no frame for this long.
   * Only for a peer that sends periodic frames; omitted, a quiet socket
   * stays open until it closes. */
  livenessTimeoutMs?: number;
}

/** Run the loop until the returned teardown is called. */
export function openReconnectingSocket<S extends ReconnectingSocketLike>(
  opts: ReconnectingSocketOptions<S>,
): () => void {
  const slow = opts.slowRetryCloseCodes ?? [];
  let closed = false;
  let dialled = false;
  /** Bumped by every dial and every abandon, so a late `open` resolution or
   * a stale socket's events never touch the current attempt. */
  let generation = 0;
  let socket: S | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  let livenessTimer: ReturnType<typeof setTimeout> | null = null;
  let dialAbort: AbortController | null = null;
  let lastState: ReconnectingSocketState | null = null;

  const report = (state: ReconnectingSocketState) => {
    if (lastState === state) return;
    lastState = state;
    try {
      opts.onState?.(state);
    } catch {
      // a consumer error never reaches the socket loop
    }
  };

  const clearAttemptTimers = () => {
    if (deadlineTimer !== null) {
      clearTimeout(deadlineTimer);
      deadlineTimer = null;
    }
    if (livenessTimer !== null) {
      clearTimeout(livenessTimer);
      livenessTimer = null;
    }
  };

  const retry = (delayMs: number = SOCKET_RETRY_MS) => {
    if (closed) return;
    report("reconnecting");
    if (retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      dial();
    }, delayMs);
  };

  /** Close a socket the loop no longer wants, with its handlers detached so
   * its own close event cannot schedule a second retry. */
  const discard = (ws: S) => {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try {
      ws.close();
    } catch {
      // a socket already closing is not an error worth propagating
    }
  };

  /** Drop the current attempt (dial in flight or socket open) and retry. */
  const abandon = () => {
    generation += 1;
    clearAttemptTimers();
    dialAbort?.abort();
    dialAbort = null;
    if (socket) {
      const ws = socket;
      socket = null;
      discard(ws);
    }
    retry();
  };

  const armLiveness = () => {
    const timeoutMs = opts.livenessTimeoutMs;
    if (timeoutMs === undefined) return;
    clearTimeout(livenessTimer ?? undefined);
    livenessTimer = setTimeout(() => {
      livenessTimer = null;
      abandon();
    }, timeoutMs);
  };

  const attach = (ws: S, gen: number) => {
    if (closed || gen !== generation) {
      discard(ws);
      return;
    }
    dialAbort = null;
    socket = ws;
    ws.onopen = () => {
      if (deadlineTimer !== null) {
        clearTimeout(deadlineTimer);
        deadlineTimer = null;
      }
      armLiveness();
      report("connected");
    };
    ws.onmessage = (ev) => {
      armLiveness();
      opts.onMessage(ev.data);
    };
    // `onclose` drives every peer-initiated reconnect, so `onerror` only has
    // to not throw.
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      socket = null;
      clearAttemptTimers();
      if (closed) return;
      // A hand-driven close may carry no event at all.
      const code = (ev as CloseEvent | undefined)?.code;
      retry(code !== undefined && slow.includes(code) ? SOCKET_SLOW_RETRY_MS : SOCKET_RETRY_MS);
    };
  };

  function dial(): void {
    if (closed) return;
    report(dialled ? "reconnecting" : "connecting");
    dialled = true;
    generation += 1;
    const gen = generation;
    const abort = new AbortController();
    dialAbort = abort;
    deadlineTimer = setTimeout(() => {
      deadlineTimer = null;
      if (gen === generation) abandon();
    }, SOCKET_CONNECT_DEADLINE_MS);
    let result: S | Promise<S>;
    try {
      result = opts.open(abort.signal);
    } catch {
      clearAttemptTimers();
      dialAbort = null;
      retry();
      return;
    }
    if (result instanceof Promise) {
      result.then(
        (ws) => attach(ws, gen),
        () => {
          if (closed || gen !== generation) return;
          clearAttemptTimers();
          dialAbort = null;
          retry();
        },
      );
    } else {
      attach(result, gen);
    }
  }

  dial();

  return () => {
    closed = true;
    generation += 1;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    clearAttemptTimers();
    dialAbort?.abort();
    dialAbort = null;
    if (socket) {
      const ws = socket;
      socket = null;
      discard(ws);
    }
    report("closed");
  };
}
