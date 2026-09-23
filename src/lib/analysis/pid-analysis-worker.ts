/**
 * Web Worker for PID analysis.
 *
 * Parses the log and runs the analysis pipeline (pid-analysis-pipeline.ts)
 * off the main thread.
 *
 * IMPORTANT: Web workers cannot use @/ path aliases. All imports are relative.
 *
 * @license GPL-3.0-only
 */

import { parseDataFlashLog } from "../dataflash-parser";
import { analyzePidLog } from "./pid-analysis-pipeline";
import type { WorkerInMessage, WorkerOutMessage, PidAnalysisResult } from "./types";

// ---------------------------------------------------------------------------
// Progress helper
// ---------------------------------------------------------------------------

function postProgress(stage: string, percent: number): void {
  const msg: WorkerOutMessage = { type: "progress", stage, percent };
  self.postMessage(msg);
}

function postResult(data: PidAnalysisResult): void {
  const msg: WorkerOutMessage = { type: "result", data };
  self.postMessage(msg);
}

function postError(message: string): void {
  const msg: WorkerOutMessage = { type: "error", message };
  self.postMessage(msg);
}

// ---------------------------------------------------------------------------
// Worker message handler
// ---------------------------------------------------------------------------

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
  const msg = event.data;

  if (msg.type === "cancel") {
    return;
  }

  if (msg.type === "analyze") {
    try {
      // 1. Parse log
      postProgress("Parsing log file...", 10);
      const log = parseDataFlashLog(msg.buffer);

      // 2. Extract, analyze and score
      const result = analyzePidLog(log, msg.buffer.byteLength, postProgress);

      postResult(result);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown analysis error";
      postError(message);
    }
  }
};
