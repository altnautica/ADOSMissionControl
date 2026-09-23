/**
 * @module logging-push.test
 * @description Verifies LoggingService.pushWindow: the single-path write to
 * the agent REST process, the selector body the agent's push route reads,
 * the pending / failed / landed outcomes it answers with, the error on a
 * non-2xx response, and the short-circuit on a cloud (https) origin.
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { LoggingService } from "@/lib/agent/agent-client/logging";
import type { RequestContext } from "@/lib/agent/agent-client/transport";

function makeService(baseUrl: string, apiKey: string | null): LoggingService {
  const ctx: RequestContext = { baseUrl, apiKey };
  return new LoggingService(ctx);
}

/** The agent's answer once the cloud service reported a landed window. */
const LANDED = {
  accepted: true,
  request_id: "0123456789abcdef0123456789abcdef",
  pushed: true,
  deduped: false,
  bytes: 4096,
  rows: 142,
  synced: true,
  window_id: "win_1",
  sha256: "abc123",
  error: null,
  pending: false,
};

/** The agent's answer when the cloud service had not answered in time. */
const PENDING = {
  accepted: true,
  request_id: "0123456789abcdef0123456789abcdef",
  pushed: false,
  deduped: false,
  bytes: 0,
  rows: 0,
  synced: false,
  error: null,
  pending: true,
};

function serve(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof serve>): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("LoggingService.pushWindow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs the selector the push route reads, with the key", async () => {
    const fetchMock = serve(LANDED);
    const svc = makeService("http://testnode.local:8080", "secret-key");
    const result = await svc.pushWindow({ session: "7", since: "-2h", kinds: ["logs"] });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://testnode.local:8080/api/logs/push");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["X-ADOS-Key"]).toBe("secret-key");
    expect(headers["Content-Type"]).toBe("application/json");
    // The session travels as an integer: a string is refused with 400.
    expect(sentBody(fetchMock)).toEqual({ session: 7, since: "-2h", kinds: ["logs"] });

    expect(result).toEqual({
      pending: false,
      window_id: "win_1",
      sha256: "abc123",
      bytes: 4096,
      rows: 142,
      deduped: false,
      synced: true,
    });
  });

  it("sends an empty selector when nothing is chosen", async () => {
    const fetchMock = serve(LANDED);
    await makeService("http://192.168.1.50:8080", null).pushWindow({});
    expect(sentBody(fetchMock)).toEqual({});
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // No key configured: the header must be absent.
    expect((init.headers as Record<string, string>)["X-ADOS-Key"]).toBeUndefined();
  });

  it("refuses a session id the route would reject, without posting", async () => {
    const fetchMock = serve(LANDED);
    await expect(
      makeService("http://testnode.local:8080", "k").pushWindow({ session: "boot-3" }),
    ).rejects.toThrow(/not a store session id/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a pending push as pending, not as exported", async () => {
    serve(PENDING, 202);
    const result = await makeService("http://testnode.local:8080", "k").pushWindow({});
    expect(result.pending).toBe(true);
    expect(result.window_id).toBeNull();
    expect(result.synced).toBe(false);
  });

  it("throws the cloud service's error instead of reporting success", async () => {
    serve({ ...LANDED, pushed: false, synced: false, error: "cloud rejected the window" });
    await expect(
      makeService("http://testnode.local:8080", "k").pushWindow({}),
    ).rejects.toThrow(/cloud rejected the window/);
  });

  it("throws when the service answered without exporting the window", async () => {
    serve({ ...LANDED, pushed: false, synced: false, window_id: null });
    await expect(
      makeService("http://testnode.local:8080", "k").pushWindow({}),
    ).rejects.toThrow(/not exported/);
  });

  it("derives the REST port even when the base url uses a different port", async () => {
    const fetchMock = serve(LANDED);
    await makeService("http://testnode.local:9999", "k").pushWindow({});
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe("http://testnode.local:8080/api/logs/push");
  });

  it("throws on a non-2xx response and surfaces the status", async () => {
    serve({ error: { code: "bad_session" } }, 400);
    await expect(
      makeService("http://testnode.local:8080", "k").pushWindow({}),
    ).rejects.toThrow(/400/);
  });

  it("short-circuits on a cloud (https) origin without touching fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      makeService("https://drone.example.com", "k").pushWindow({}),
    ).rejects.toThrow(/push unavailable/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
