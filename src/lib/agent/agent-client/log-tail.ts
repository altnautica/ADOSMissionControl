/**
 * @module agent/agent-client/log-tail
 * @description The live log tail reader. The store's `/v1/tail` is a
 * Server-Sent-Events stream that authorises only the `X-ADOS-Key` header, and
 * `EventSource` cannot send a header, so the stream is read with `fetch` and
 * parsed here. The key therefore never lands in a URL, a network log or a
 * fronting proxy's access log.
 *
 * Frames are the store's log rows (the replay backlog, shaped like `LogRow`)
 * followed by live frames (`{kind:"log", ts_us, source, level, target, msg,
 * fields}`); both are normalised to `LoggingRow`. A `lagged` event and
 * keep-alive comments are skipped.
 * @license GPL-3.0-only
 */

import type { LoggingRow } from "./logging";
import { normaliseLogRow } from "./logging-wire";

export interface LogTailHandlers {
  onRow: (row: LoggingRow) => void;
  /** Called once when the stream is refused, fails, or ends. Never called
   * after `close()`. */
  onError: (err: Error) => void;
}

export interface LogTail {
  close(): void;
}

/** Split an SSE byte stream into events and hand each `message` event's
 * parsed JSON to `onData`. Returns the unconsumed tail of `buffer`. */
function drainEvents(buffer: string, onData: (data: unknown) => void): string {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line === "" || line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon === -1 ? line : line.slice(0, colon);
      const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (event !== "message" || data.length === 0) continue;
    try {
      onData(JSON.parse(data.join("\n")));
    } catch {
      /* a malformed frame is skipped, the stream continues */
    }
  }
  return rest;
}

/** Open the tail. `connectTimeoutMs` bounds only the wait for the response
 * headers; a healthy stream then stays open indefinitely. */
export function openLogTail(
  url: string,
  headers: Record<string, string>,
  connectTimeoutMs: number,
  handlers: LogTailHandlers,
): LogTail {
  const ctrl = new AbortController();
  let closed = false;
  let failed = false;
  let seq = 0;
  const fail = (err: Error) => {
    if (closed || failed) return;
    failed = true;
    ctrl.abort();
    handlers.onError(err);
  };
  const connectTimer = setTimeout(
    () => fail(new Error("log tail connect timed out")),
    connectTimeoutMs,
  );

  void (async () => {
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: ctrl.signal });
    } catch (err) {
      clearTimeout(connectTimer);
      fail(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    clearTimeout(connectTimer);
    if (!res.ok || !res.body) {
      fail(new Error(`log tail refused: ${res.status}`));
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const onData = (frame: unknown) => {
      if (closed) return;
      const f = frame as { kind?: unknown; msg?: unknown };
      // Live frames name their table in `kind`; replay rows carry none.
      if (f.kind !== undefined && f.kind !== "log") return;
      if (typeof f.msg !== "string") return;
      handlers.onRow(normaliseLogRow(frame, seq++));
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer = drainEvents(buffer + decoder.decode(value, { stream: true }), onData);
      }
      fail(new Error("log tail ended"));
    } catch (err) {
      fail(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return {
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(connectTimer);
      ctrl.abort();
    },
  };
}
