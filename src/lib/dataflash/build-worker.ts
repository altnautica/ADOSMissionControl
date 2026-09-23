/**
 * @module dataflash/build-worker
 * @description Web Worker that parses a `.bin` log and builds its flights off
 * the main thread. The buffer arrives transferred; the reply carries the
 * built flights or the parser's error.
 *
 * Bundlers (webpack, turbopack, vite) inline this file as a worker chunk when
 * they see the `new Worker(new URL(...), { type: "module" })` form.
 *
 * @license GPL-3.0-only
 */

import { buildDataflashFlights, type DataflashBuildRequest, type DataflashBuildResponse } from "./build";

self.onmessage = (event: MessageEvent<DataflashBuildRequest>) => {
  const { buffer, options } = event.data;
  let response: DataflashBuildResponse;
  try {
    response = { ok: true, build: buildDataflashFlights(new Uint8Array(buffer), options) };
  } catch (err) {
    response = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};
