/**
 * Streaming DataFlash .bin log parser for large files (>50MB).
 *
 * Processes the buffer in configurable-size chunks with progress callbacks,
 * yielding to the event loop between chunks so the UI stays responsive.
 *
 * @license GPL-3.0-only
 */

import type { DataFlashLog } from "./dataflash-parser";
import { createDataFlashScan, scanDataFlash } from "./dataflash-parser";

/** Progress callback for streaming parse — receives 0-1 progress fraction. */
export type StreamingProgressCallback = (progress: number) => void;

/** Options for the streaming parser. */
export interface StreamingParseOptions {
  /** Called with progress (0-1) during parsing. */
  onProgress?: StreamingProgressCallback;
  /** Size of each chunk to process per iteration (default: 1MB). */
  chunkSize?: number;
}

/**
 * Parse a DataFlash .bin log file in chunks, yielding to the event loop
 * between chunks so the UI stays responsive. Suitable for files >50MB.
 *
 * Same output as `parseDataFlashLog` but processes the buffer in
 * configurable-size chunks with progress callbacks.
 */
export async function parseDataFlashLogStreaming(
  buffer: ArrayBuffer,
  options: StreamingParseOptions = {},
): Promise<DataFlashLog> {
  const { onProgress, chunkSize = 1024 * 1024 } = options;
  const len = buffer.byteLength;
  const scan = createDataFlashScan(buffer);

  // Each chunk parses until the position passes the next boundary, then
  // yields to the event loop. The position always advances, so every chunk
  // ends and the parse finishes.
  while (scanDataFlash(scan, scan.pos + chunkSize)) {
    onProgress?.(scan.pos / len);
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  }

  onProgress?.(1);
  return { formats: scan.formats, messages: scan.messages };
}
