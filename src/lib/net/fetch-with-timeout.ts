/**
 * @module net/fetch-with-timeout
 * @description Abortable fetch wrapper for server-side route handlers.
 *
 * Server-side fetch in Next.js route handlers does not propagate the
 * client's disconnect, so a slow upstream response can keep the request
 * pinned in memory long after the browser has navigated away. Wrap any
 * upstream fetch in fetchWithTimeout so the request is bounded and the
 * caller's AbortSignal (if any) is respected. The bound covers the whole
 * exchange, body included: an upstream that sends headers and then stalls
 * is aborted at the deadline, and so is one whose client went away.
 *
 * @license GPL-3.0-only
 */

export interface FetchWithTimeoutOptions extends RequestInit {
  /** Hard upper bound in milliseconds. Default 60_000. */
  timeoutMs?: number;
  /** External abort signal. Combined with the internal timeout. */
  upstreamSignal?: AbortSignal | null;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * fetch() with a timeout that always cleans up the controller.
 * Throws DOMException("AbortError") when the timeout fires or the
 * upstream signal aborts. Re-throws any underlying network error.
 *
 * The timer and the upstream-signal listener stay armed until the returned
 * response's body has been read to the end or cancelled, so a body read is
 * bounded by the same deadline as the headers.
 */
export async function fetchWithTimeout(
  url: string | URL,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, upstreamSignal, signal: _ignored, ...rest } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // If the caller passed their own signal (e.g., NextRequest.signal that
  // tracks the client connection), abort our controller when it fires.
  let upstreamHandler: (() => void) | null = null;
  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      upstreamHandler = () => controller.abort();
      upstreamSignal.addEventListener("abort", upstreamHandler, { once: true });
    }
  }

  const release = () => {
    clearTimeout(timer);
    if (upstreamSignal && upstreamHandler) {
      upstreamSignal.removeEventListener("abort", upstreamHandler);
    }
  };

  let res: Response;
  try {
    res = await fetch(url, { ...rest, signal: controller.signal });
  } catch (err) {
    release();
    throw err;
  }
  if (!res.body) {
    release();
    return res;
  }

  // Re-wrap the body so the bound is released only when the body is done.
  // An abort after this point errors the upstream body, which surfaces here.
  const reader = res.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          release();
          ctrl.close();
          return;
        }
        ctrl.enqueue(value);
      } catch (err) {
        release();
        ctrl.error(err);
      }
    },
    cancel(reason) {
      release();
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

export async function readArrayBufferWithLimit(
  response: Response,
  maxBytes: number,
): Promise<ArrayBuffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Upstream response too large");
  }

  if (!response.body) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      throw new Error("Upstream response too large");
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      received += value.byteLength;
      if (received > maxBytes) {
        // Close the upstream body rather than leave it streaming unread.
        await reader.cancel().catch(() => undefined);
        throw new Error("Upstream response too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
