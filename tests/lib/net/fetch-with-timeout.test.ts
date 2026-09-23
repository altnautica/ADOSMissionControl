import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchWithTimeout, readArrayBufferWithLimit } from "@/lib/net/fetch-with-timeout";

/** A fetch double whose body sends one chunk and then stalls, erroring when
 * the request signal aborts, as a real fetch body does. */
function stallingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(new TextEncoder().encode("{\"partial\":"));
        init?.signal?.addEventListener("abort", () =>
          ctrl.error(new DOMException("aborted", "AbortError")),
        );
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  });
}

describe("fetchWithTimeout", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the upstream response on success", async () => {
    const response = new Response("ok", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(response);

    const res = await fetchWithTimeout("https://example.com");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("aborts when the timeout fires", async () => {
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    await expect(
      fetchWithTimeout("https://example.com", { timeoutMs: 10 }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts when the upstream signal aborts", async () => {
    const upstream = new AbortController();
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    setTimeout(() => upstream.abort(), 5);

    await expect(
      fetchWithTimeout("https://example.com", {
        upstreamSignal: upstream.signal,
        timeoutMs: 10_000,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("aborts immediately when upstream signal is already aborted", async () => {
    const upstream = new AbortController();
    upstream.abort();

    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
            return;
          }
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );

    await expect(
      fetchWithTimeout("https://example.com", {
        upstreamSignal: upstream.signal,
        timeoutMs: 10_000,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("clears the timer once the body has been read", async () => {
    const response = new Response("ok", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(response);
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");

    const res = await fetchWithTimeout("https://example.com", { timeoutMs: 5_000 });
    expect(await res.text()).toBe("ok");
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("bounds a body that stalls after the headers", async () => {
    globalThis.fetch = stallingFetch();
    const res = await fetchWithTimeout("https://example.com", { timeoutMs: 20 });
    await expect(res.text()).rejects.toMatchObject({ name: "AbortError" });
  }, 2_000);

  it("aborts a stalled body read when the client goes away", async () => {
    globalThis.fetch = stallingFetch();
    const upstream = new AbortController();
    const res = await fetchWithTimeout("https://example.com", {
      upstreamSignal: upstream.signal,
      timeoutMs: 60_000,
    });
    const reading = res.arrayBuffer();
    upstream.abort();
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
  }, 2_000);

  it("does not abort upstream signal when the request finishes first", async () => {
    const upstream = new AbortController();
    const response = new Response("ok", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(response);

    const res = await fetchWithTimeout("https://example.com", {
      upstreamSignal: upstream.signal,
    });

    expect(res.status).toBe(200);
    expect(upstream.signal.aborted).toBe(false);
  });

  it("propagates non-abort fetch errors verbatim", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("network down"));
    await expect(
      fetchWithTimeout("https://example.com"),
    ).rejects.toThrow("network down");
  });
});

describe("readArrayBufferWithLimit", () => {
  it("cancels the upstream body when it overflows the limit", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        ctrl.enqueue(new Uint8Array(64));
      },
      cancel,
    });
    await expect(
      readArrayBufferWithLimit(new Response(body), 100),
    ).rejects.toThrow("Upstream response too large");
    expect(cancel).toHaveBeenCalled();
  });
});
