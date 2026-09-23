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

export function buildDataflashFlights(bytes: Uint8Array, options: DataflashConvertOptions): DataflashBuild {
  const log = parseDataflashLog(bytes, { only: DATAFLASH_FLIGHT_MESSAGES });
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
export type DataflashBuildResponse = { ok: true; build: DataflashBuild } | { ok: false; error: string };

/**
 * Run {@link buildDataflashFlights} in a Web Worker so a large log never
 * freezes the UI. Where workers do not exist (tests, server rendering) it
 * runs inline. Rejects with the parser's error on a corrupt log.
 */
export function buildDataflashFlightsOffThread(
  bytes: Uint8Array,
  options: DataflashConvertOptions,
): Promise<DataflashBuild> {
  if (typeof Worker === "undefined") {
    return Promise.resolve().then(() => buildDataflashFlights(bytes, options));
  }
  const { promise, resolve, reject } = Promise.withResolvers<DataflashBuild>();
  const worker = new Worker(new URL("./build-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<DataflashBuildResponse>) => {
    worker.terminate();
    if (e.data.ok) resolve(e.data.build);
    else reject(new Error(e.data.error));
  };
  worker.onerror = (e) => {
    worker.terminate();
    reject(new Error(e.message || "Log parse worker crashed"));
  };
  // Transfer a copy: the caller keeps its bytes, and the copy moves to the
  // worker without a second structured clone.
  const request: DataflashBuildRequest = { buffer: bytes.slice().buffer, options };
  worker.postMessage(request, [request.buffer]);
  return promise;
}
