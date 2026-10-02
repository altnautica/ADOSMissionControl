/**
 * @module flight-log-build-worker
 * @description Web Worker that parses a `.ulg` or `.tlog` log and builds its
 * flights off the main thread, reporting progress as it reads.
 *
 * Bundlers (webpack, turbopack, vite) inline this file as a worker chunk when
 * they see the `new Worker(new URL(...), { type: "module" })` form.
 *
 * @license GPL-3.0-only
 */

import { buildFlightLog, type FlightLogBuildRequest, type FlightLogBuildResponse } from "./flight-log-build";

self.onmessage = async (event: MessageEvent<FlightLogBuildRequest>) => {
  const { format, buffer, filename } = event.data;
  const post = (msg: FlightLogBuildResponse) => self.postMessage(msg);
  try {
    const flights = await buildFlightLog(format, buffer, filename, (fraction) => post({ type: "progress", fraction }));
    post({ type: "done", flights });
  } catch (err) {
    post({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
