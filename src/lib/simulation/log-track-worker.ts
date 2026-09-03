/**
 * @module simulation/log-track-worker
 * @description Web Worker that turns a raw flight-log buffer into a flown
 * track, off the main thread.
 *
 * Parsing a dataflash / ULog / tlog file is CPU-bound and takes seconds on a
 * real flight log; on the main thread that froze the whole UI, including the
 * spinner meant to say it was working. The buffer arrives transferred (zero
 * copy) and the caller gets back either the positions or a typed error.
 *
 * Bundlers (webpack, turbopack, vite) inline this file as a worker chunk when
 * they see the `new Worker(new URL(...), { type: "module" })` form.
 *
 * @license GPL-3.0-only
 */

import {
  parseLogTrack,
  type LogTrackError,
  type TrackPoint,
} from "./log-track";

/** Request: a raw log buffer plus the filename it came from. */
export interface LogTrackWorkerRequest {
  /** Lowercase extension without the dot. */
  ext: string;
  /** Original filename, used by the parsers for record provenance. */
  name: string;
  buffer: ArrayBuffer;
}

/** Response: positions, or the typed reason there are none. */
export type LogTrackWorkerResponse =
  | { ok: true; positions: TrackPoint[] }
  | { ok: false; error: LogTrackError };

self.onmessage = (event: MessageEvent<LogTrackWorkerRequest>) => {
  const { ext, name, buffer } = event.data;
  const result = parseLogTrack(ext, buffer, name);
  const response: LogTrackWorkerResponse = result.ok
    ? { ok: true, positions: result.positions }
    : { ok: false, error: result.error };
  self.postMessage(response);
};
