import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchArrayBufferWithProgress,
  type FetchProgress,
} from "@/lib/net/fetch-with-progress";

/** Concatenate chunks (mirrors the helper's own concat for assertions). */
function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

/**
 * A minimal streaming Response fake — controls chunk delivery + Content-Length
 * exactly, without depending on the runtime's ReadableStream Response body.
 */
function fakeResponse(
  chunks: Uint8Array[],
  opts: {
    contentLength?: number | null;
    ok?: boolean;
    status?: number;
    noBody?: boolean;
  } = {},
): Response {
  const headers = new Map<string, string>();
  if (opts.contentLength != null) {
    headers.set("content-length", String(opts.contentLength));
  }
  let i = 0;
  const body = opts.noBody
    ? null
    : {
        getReader() {
          return {
            read: async () =>
              i < chunks.length
                ? { done: false as const, value: chunks[i++] }
                : { done: true as const, value: undefined },
          };
        },
      };
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    body,
    arrayBuffer: async () => concat(chunks).buffer,
  } as unknown as Response;
}

function stubFetch(res: Response) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchArrayBufferWithProgress", () => {
  it("reports determinate percent from Content-Length and returns the bytes", async () => {
    const chunks = [Uint8Array.from([1, 2, 3]), Uint8Array.from([4, 5])]; // 5 bytes
    stubFetch(fakeResponse(chunks, { contentLength: 5 }));

    const seen: FetchProgress[] = [];
    const buf = await fetchArrayBufferWithProgress("http://x/a.ply", {
      onProgress: (p) => seen.push(p),
    });

    expect(new Uint8Array(buf)).toEqual(Uint8Array.from([1, 2, 3, 4, 5]));
    // First chunk = 3/5 = 60%, final = 100%.
    expect(seen[0]).toEqual({ receivedBytes: 3, totalBytes: 5, percent: 60 });
    expect(seen.at(-1)).toEqual({
      receivedBytes: 5,
      totalBytes: 5,
      percent: 100,
    });
  });

  it("is indeterminate (null percent/total) when Content-Length is absent", async () => {
    const chunks = [Uint8Array.from([9, 9, 9])];
    stubFetch(fakeResponse(chunks, { contentLength: null }));

    const seen: FetchProgress[] = [];
    const buf = await fetchArrayBufferWithProgress("http://x/a.ply", {
      onProgress: (p) => seen.push(p),
    });

    expect(new Uint8Array(buf)).toEqual(Uint8Array.from([9, 9, 9]));
    expect(seen.at(-1)).toEqual({
      receivedBytes: 3,
      totalBytes: null,
      percent: null,
    });
  });

  it("throws on a non-2xx response", async () => {
    stubFetch(fakeResponse([], { ok: false, status: 404 }));
    await expect(
      fetchArrayBufferWithProgress("http://x/missing"),
    ).rejects.toThrow("fetch 404");
  });

  it("falls back to arrayBuffer() when the response has no readable body", async () => {
    const chunks = [Uint8Array.from([7, 7])];
    stubFetch(fakeResponse(chunks, { contentLength: 2, noBody: true }));

    const seen: FetchProgress[] = [];
    const buf = await fetchArrayBufferWithProgress("http://x/a.ply", {
      onProgress: (p) => seen.push(p),
    });

    expect(new Uint8Array(buf)).toEqual(Uint8Array.from([7, 7]));
    expect(seen).toEqual([{ receivedBytes: 2, totalBytes: 2, percent: 100 }]);
  });

  it("aborts with 'download stalled' when the body stops delivering chunks", async () => {
    vi.useFakeTimers();
    try {
      let reads = 0;
      let requestSignal: AbortSignal | undefined;
      const res = {
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            // One chunk, then the connection goes quiet forever.
            read: () =>
              reads++ === 0
                ? Promise.resolve({ done: false as const, value: Uint8Array.from([1]) })
                : Promise.withResolvers<never>().promise,
          }),
        },
      } as unknown as Response;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          requestSignal = init?.signal ?? undefined;
          return Promise.resolve(res);
        }),
      );

      const pending = fetchArrayBufferWithProgress("http://x/a.ply", { stallTimeoutMs: 1_000 });
      const outcome = expect(pending).rejects.toThrow("download stalled");
      await vi.advanceTimersByTimeAsync(1_500);
      await outcome;
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
