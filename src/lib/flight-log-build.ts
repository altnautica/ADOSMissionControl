/**
 * Parse a PX4 `.ulg` or MAVLink `.tlog` log and build its flights: the
 * CPU-bound half of those imports, pure and runnable in a Web Worker.
 *
 * Flight ids derive from a SHA-256 of the file's bytes, so importing the same
 * file twice yields the same ids and history keeps one copy.
 *
 * @module flight-log-build
 * @license GPL-3.0-only
 */

import { parseUlog } from "./ulog/parser";
import { ulogToFlightRecords, ULOG_FLIGHT_TOPICS } from "./ulog/to-flight-record";
import { parseTlog, tlogToFlightRecord } from "./tlog/parser";
import type { TelemetryFrame } from "./telemetry-recorder";
import type { FlightRecord } from "./types";

export type BuiltLogFormat = "ulg" | "tlog";

export interface BuiltLogFlight {
  record: FlightRecord;
  frames: TelemetryFrame[];
}

/** First 16 hex characters of the SHA-256 of `buffer`. */
export async function logContentId(buffer: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  let hex = "";
  for (let i = 0; i < 8; i++) hex += digest[i].toString(16).padStart(2, "0");
  return hex;
}

export async function buildFlightLog(
  format: BuiltLogFormat,
  buffer: ArrayBuffer,
  filename: string,
  onProgress?: (fraction: number) => void,
): Promise<BuiltLogFlight[]> {
  const fileId = await logContentId(buffer);
  if (format === "ulg") {
    return ulogToFlightRecords(parseUlog(buffer, { only: ULOG_FLIGHT_TOPICS, onProgress }), fileId, filename);
  }
  const built = tlogToFlightRecord(parseTlog(buffer, { onProgress }), fileId, filename);
  return built ? [built] : [];
}

/** Request to the build worker. The buffer arrives transferred. */
export interface FlightLogBuildRequest {
  format: BuiltLogFormat;
  buffer: ArrayBuffer;
  filename: string;
}

/** Reply from the build worker. */
export type FlightLogBuildResponse =
  | { type: "progress"; fraction: number }
  | { type: "done"; flights: BuiltLogFlight[] }
  | { type: "error"; error: string };

export interface FlightLogBuildOptions {
  /** Fraction of the file parsed, 0..1. */
  onProgress?: (fraction: number) => void;
  /** Aborting stops the parse; the promise rejects with an `AbortError`. */
  signal?: AbortSignal;
}

function abortError(): DOMException {
  return new DOMException("Import cancelled", "AbortError");
}

/**
 * Run {@link buildFlightLog} in a Web Worker so a large log never freezes the
 * UI, with progress and cancel. Where workers do not exist (tests, server
 * rendering) it runs inline. Rejects with the parser's error on a corrupt log.
 */
export function buildFlightLogOffThread(
  format: BuiltLogFormat,
  bytes: Uint8Array,
  filename: string,
  options: FlightLogBuildOptions = {},
): Promise<BuiltLogFlight[]> {
  const { onProgress, signal } = options;
  if (signal?.aborted) return Promise.reject(abortError());
  // A copy the parser owns: the caller keeps its bytes, and the copy can be
  // transferred to the worker without a second structured clone.
  const buffer = bytes.slice().buffer;
  if (typeof Worker === "undefined") {
    return buildFlightLog(format, buffer, filename, onProgress).then((flights) => {
      if (signal?.aborted) throw abortError();
      return flights;
    });
  }
  const { promise, resolve, reject } = Promise.withResolvers<BuiltLogFlight[]>();
  const worker = new Worker(new URL("./flight-log-build-worker.ts", import.meta.url), { type: "module" });
  const onAbort = () => {
    worker.terminate();
    reject(abortError());
  };
  const finish = () => {
    worker.terminate();
    signal?.removeEventListener("abort", onAbort);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  worker.onmessage = (e: MessageEvent<FlightLogBuildResponse>) => {
    const msg = e.data;
    if (msg.type === "progress") {
      onProgress?.(msg.fraction);
      return;
    }
    finish();
    if (msg.type === "done") resolve(msg.flights);
    else reject(new Error(msg.error));
  };
  worker.onerror = (e) => {
    finish();
    reject(new Error(e.message || "Log parse worker crashed"));
  };
  const request: FlightLogBuildRequest = { format, buffer, filename };
  worker.postMessage(request, [buffer]);
  return promise;
}
