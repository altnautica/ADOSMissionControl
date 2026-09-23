/**
 * @module lib/net/fetch-with-progress
 * @description Fetch a binary artifact into an `ArrayBuffer` while reporting
 * byte-accurate download progress. Streams the response body chunk by chunk
 * (`response.body.getReader()`), deriving the total from `Content-Length` so a
 * caller can render a determinate progress bar; when the header is absent it
 * still reports received bytes and leaves `percent` null (indeterminate). The
 * reusable form of the loop previously embedded only in the firmware-flash hook.
 * @license GPL-3.0-only
 */

/** A download-progress sample. `percent`/`totalBytes` are null when the server
 * sends no `Content-Length` (chunked transfer). */
export interface FetchProgress {
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export interface FetchWithProgressOptions {
  /** Abort the download (e.g. on unmount / url change). */
  signal?: AbortSignal;
  /** Called on every chunk with the running byte + percent totals. */
  onProgress?: (progress: FetchProgress) => void;
  /** Abort with "download stalled" when no response or chunk arrives for this
   * long. Re-armed on every chunk, so a slow but moving download never trips
   * it. Default 30 s. */
  stallTimeoutMs?: number;
}

const DEFAULT_STALL_TIMEOUT_MS = 30_000;

/**
 * Fetch `url` into an `ArrayBuffer`, invoking `onProgress` as bytes arrive.
 * Throws on a non-2xx response, an aborted signal, or a stalled transfer.
 */
export async function fetchArrayBufferWithProgress(
  url: string,
  {
    signal,
    onProgress,
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
  }: FetchWithProgressOptions = {},
): Promise<ArrayBuffer> {
  // One controller carries both the caller's abort and the stall abort, so a
  // stalled transfer also tears down the underlying request.
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });

  const stall = Promise.withResolvers<never>();
  // Only ever observed through the races below.
  stall.promise.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const armStall = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort();
      stall.reject(new Error("download stalled"));
    }, stallTimeoutMs);
  };

  try {
    armStall();
    const res = await Promise.race([fetch(url, { signal: controller.signal }), stall.promise]);
    if (!res.ok) throw new Error(`fetch ${res.status}`);

    const header = res.headers.get("Content-Length");
    const parsed = header ? Number(header) : NaN;
    const totalBytes =
      Number.isFinite(parsed) && parsed > 0 ? parsed : null;

    const reader = res.body?.getReader();
    if (!reader) {
      // No streaming body (opaque response / older runtime): single read.
      armStall();
      const buffer = await Promise.race([res.arrayBuffer(), stall.promise]);
      onProgress?.({
        receivedBytes: buffer.byteLength,
        totalBytes,
        percent: totalBytes ? 100 : null,
      });
      return buffer;
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      armStall();
      const { done, value } = await Promise.race([reader.read(), stall.promise]);
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      received += value.byteLength;
      onProgress?.({
        receivedBytes: received,
        totalBytes,
        percent: totalBytes ? Math.min(100, (received / totalBytes) * 100) : null,
      });
    }

    // Concatenate the chunks into one contiguous buffer.
    const out = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out.buffer;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", forwardAbort);
  }
}
