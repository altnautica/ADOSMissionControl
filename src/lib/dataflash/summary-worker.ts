/**
 * @module dataflash/summary-worker
 * @description Web Worker that counts the messages of a `.bin` log off the
 * main thread, reporting progress as it reads.
 *
 * @license GPL-3.0-only
 */

import { summarizeDataflash, type DataflashSummaryRequest, type DataflashSummaryResponse } from "./summary";

self.onmessage = (event: MessageEvent<DataflashSummaryRequest>) => {
  const post = (msg: DataflashSummaryResponse) => self.postMessage(msg);
  try {
    const summary = summarizeDataflash(new Uint8Array(event.data.buffer), (fraction) =>
      post({ type: "progress", fraction }),
    );
    post({ type: "done", summary });
  } catch (err) {
    post({ type: "error", error: err instanceof Error ? err.message : String(err) });
  }
};
