/**
 * Parse a `.bin` log and build its flights: the CPU-bound half of a dataflash
 * import, pure and runnable in a Web Worker.
 *
 * Only the messages a flight record uses are decoded; the high-rate rows
 * (IMU, EKF, PID, ...) that dominate a log's size are stepped over.
 *
 * @module dataflash/build
 * @license GPL-3.0-only
 */

import { parseDataflashLog } from "./parser";
import {
  dataflashToFlightRecords,
  DATAFLASH_FLIGHT_MESSAGES,
  type BuiltFlight,
  type DataflashConvertOptions,
} from "./to-flight-record";

export interface DataflashBuild {
  flights: BuiltFlight[];
  bytesRead: number;
  resyncSkipped: number;
  /** The log carries no RC input rows (LOG_BITMASK without RCIN). */
  rcInMissing: boolean;
  paramCount: number;
}

export function buildDataflashFlights(
  bytes: Uint8Array,
  options: DataflashConvertOptions,
  onProgress?: (fraction: number) => void,
): DataflashBuild {
  const log = parseDataflashLog(bytes, { only: DATAFLASH_FLIGHT_MESSAGES, onProgress });
  return {
    flights: dataflashToFlightRecords(log, options),
    bytesRead: log.bytesRead,
    resyncSkipped: log.resyncSkipped,
    rcInMissing: (log.messages.get("RCIN") ?? []).length === 0,
    paramCount: log.params.size,
  };
}

/** Request to the build worker. */
export interface DataflashBuildRequest {
  buffer: ArrayBuffer;
  options: DataflashConvertOptions;
}

/** Reply from the build worker. */
export type DataflashBuildResponse =
  | { type: "progress"; fraction: number }
  | { type: "done"; build: DataflashBuild }
  | { type: "error"; error: string };

export interface DataflashBuildRunOptions {
  /** Fraction of the file parsed, 0..1. */
  onProgress?: (fraction: number) => void;
  /** Aborting stops the parse; the promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

/**
 * Run {@link buildDataflashFlights} in a Web Worker so a large log never
 * freezes the UI, with progress and cancel. Where workers do not exist
 * (tests, server rendering) it runs inline. Rejects with the parser's error
 * on a corrupt log.
 */
export function buildDataflashFlightsOffThread(
  bytes: Uint8Array,
  options: DataflashConvertOptions,
  run: DataflashBuildRunOptions = {},
): Promise<DataflashBuild> {
  const { onProgress, signal } = run;
  const cancelled = () => new DOMException("Import cancelled", "AbortError");
  if (signal?.aborted) return Promise.reject(cancelled());
  if (typeof Worker === "undefined") {
    return Promise.resolve().then(() => buildDataflashFlights(bytes, options, onProgress));
  }
  const { promise, resolve, reject } = Promise.withResolvers<DataflashBuild>();
  const worker = new Worker(new URL("./build-worker.ts", import.meta.url), { type: "module" });
  const onAbort = () => {
    worker.terminate();
    reject(cancelled());
  };
  const finish = () => {
    worker.terminate();
    signal?.removeEventListener("abort", onAbort);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  worker.onmessage = (e: MessageEvent<DataflashBuildResponse>) => {
    const msg = e.data;
    if (msg.type === "progress") {
      onProgress?.(msg.fraction);
      return;
    }
    finish();
    if (msg.type === "done") resolve(msg.build);
    else reject(new Error(msg.error));
  };
  worker.onerror = (e) => {
    finish();
    reject(new Error(e.message || "Log parse worker crashed"));
  };
  // Transfer a copy: the caller keeps its bytes, and the copy moves to the
  // worker without a second structured clone.
  const request: DataflashBuildRequest = { buffer: bytes.slice().buffer, options };
  worker.postMessage(request, [request.buffer]);
  return promise;
}
