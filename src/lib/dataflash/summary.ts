/**
 * Message counts of a `.bin` log, without decoding or keeping its rows.
 *
 * @module dataflash/summary
 * @license GPL-3.0-only
 */

import { parseDataflashLog } from "./parser";

export interface DataflashSummary {
  /** Frames per message name, sorted by name. */
  counts: [name: string, count: number][];
  bytesRead: number;
  resyncSkipped: number;
}

/** No message is decoded: every frame is counted and stepped over. */
const DECODE_NOTHING: ReadonlySet<string> = new Set();

export function summarizeDataflash(bytes: Uint8Array, onProgress?: (fraction: number) => void): DataflashSummary {
  const log = parseDataflashLog(bytes, { only: DECODE_NOTHING, onProgress });
  return {
    counts: [...log.counts.entries()].sort(([a], [b]) => a.localeCompare(b)),
    bytesRead: log.bytesRead,
    resyncSkipped: log.resyncSkipped,
  };
}

/** Request to the summary worker: the log bytes, transferred. */
export interface DataflashSummaryRequest {
  buffer: ArrayBuffer;
}

/** Reply from the summary worker. */
export type DataflashSummaryResponse =
  | { type: "progress"; fraction: number }
  | { type: "done"; summary: DataflashSummary }
  | { type: "error"; error: string };

/**
 * Run {@link summarizeDataflash} in a Web Worker so a large log never
 * freezes the UI. Where workers do not exist it runs inline. Rejects with the
 * parser's error, or a worker crash.
 */
export function summarizeDataflashOffThread(
  buffer: ArrayBuffer,
  onProgress?: (fraction: number) => void,
): Promise<DataflashSummary> {
  if (typeof Worker === "undefined") {
    return Promise.resolve().then(() => summarizeDataflash(new Uint8Array(buffer), onProgress));
  }
  const { promise, resolve, reject } = Promise.withResolvers<DataflashSummary>();
  const worker = new Worker(new URL("./summary-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<DataflashSummaryResponse>) => {
    const msg = e.data;
    if (msg.type === "progress") {
      onProgress?.(msg.fraction);
      return;
    }
    worker.terminate();
    if (msg.type === "done") resolve(msg.summary);
    else reject(new Error(msg.error));
  };
  worker.onerror = (e) => {
    worker.terminate();
    reject(new Error(e.message || "Log parse worker crashed"));
  };
  const request: DataflashSummaryRequest = { buffer };
  worker.postMessage(request, [buffer]);
  return promise;
}
