/**
 * @module dataflash/build-worker
 * @description Web Worker that parses a `.bin` log and builds its flights off
 * the main thread. The buffer arrives transferred; the worker reports parse
 * progress, then replies with the built flights or the parser's error.
 *
 * Bundlers (webpack, turbopack, vite) inline this file as a worker chunk when
 * they see the `new Worker(new URL(...), { type: "module" })` form.
 *
 * @license GPL-3.0-only
 */

import { buildDataflashFlights, type DataflashBuildRequest, type DataflashBuildResponse } from "./build";

self.onmessage = (event: MessageEvent<DataflashBuildRequest>) => {
  const { buffer, options } = event.data;
  const post = (msg: DataflashBuildResponse) => self.postMessage(msg);
  try {
    const build = buildDataflashFlights(new Uint8Array(buffer), options, (fraction) =>
      post({ type: "progress", fraction }),
    );
    post({ type: "done", build });
  } catch (err) {
    post({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
