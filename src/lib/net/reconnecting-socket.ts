/**
 * @module net/reconnecting-socket
 * @description The one reconnect loop every long-lived WebSocket stream
 * uses. The retry delay is fixed and never grows, and an open that the peer
 * closes at once never shortens it, so a refusing or flapping handler costs
 * one dial every few seconds rather than a storm, while a peer that is not up
 * yet is still noticed within one delay of coming up. Close codes after which
 * retrying cannot change the answer end the loop and surface as `closed`.
 * @license GPL-3.0-only
 */

/** Fixed delay between a failed or closed socket and the next dial. */
export const SOCKET_RETRY_MS = 3000;

/** The subset of `WebSocket` the loop drives, so a test can inject one. */
export interface ReconnectingSocketLike {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  close: () => void;
}

/** `connecting` before the first dial, `reconnecting` while retrying,
 * `closed` after teardown or a terminal close code. Repeats are collapsed. */
export type ReconnectingSocketState = "connecting" | "connected" | "reconnecting" | "closed";

export interface ReconnectingSocketOptions<S extends ReconnectingSocketLike> {
  /** Dial one socket. A throw or rejection counts as a failed attempt. The
   * signal aborts when the loop is torn down mid-dial. */
  open: (signal: AbortSignal) => S | Promise<S>;
  /** One frame's payload, exactly as the socket delivered it. */
  onMessage: (data: unknown) => void;
  onState?: (state: ReconnectingSocketState) => void;
  /** Close codes that mean the peer refuses this stream for good. */
  terminalCloseCodes?: readonly number[];
}

/** Run the loop until the returned teardown is called. */
export function openReconnectingSocket<S extends ReconnectingSocketLike>(
  opts: ReconnectingSocketOptions<S>,
): () => void {
  const terminal = opts.terminalCloseCodes ?? [];
  let closed = false;
  let dialled = false;
  let socket: S | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
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

  const retry = () => {
    if (closed) return;
    report("reconnecting");
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      dial();
    }, SOCKET_RETRY_MS);
  };

  const attach = (ws: S) => {
    if (closed) {
      try {
        ws.close();
      } catch {
        // a socket already closing is not an error worth propagating
      }
      return;
    }
    socket = ws;
    ws.onopen = () => report("connected");
    ws.onmessage = (ev) => opts.onMessage(ev.data);
    // `onclose` drives every reconnect, so `onerror` only has to not throw.
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      socket = null;
      if (closed) return;
      // A hand-driven close may carry no event at all.
      const code = (ev as CloseEvent | undefined)?.code;
      if (code !== undefined && terminal.includes(code)) {
        closed = true;
        report("closed");
        return;
      }
      retry();
    };
  };

  function dial(): void {
    if (closed) return;
    report(dialled ? "reconnecting" : "connecting");
    dialled = true;
    const abort = new AbortController();
    dialAbort = abort;
    let result: S | Promise<S>;
    try {
      result = opts.open(abort.signal);
    } catch {
      retry();
      return;
    }
    if (result instanceof Promise) {
      result.then(attach, () => retry());
    } else {
      attach(result);
    }
  }

  dial();

  return () => {
    closed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    dialAbort?.abort();
    dialAbort = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // a socket already closing is not an error worth propagating
      }
      socket = null;
    }
    report("closed");
  };
}
