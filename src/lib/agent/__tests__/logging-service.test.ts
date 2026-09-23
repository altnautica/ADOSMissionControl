/**
 * @module logging-service.test
 * @description Unit tests for the durable-store reader's two-tier
 * transport resolution (proxy → legacy), envelope normalisation, legacy
 * shape mapping, keyset pagination, hard-error non-cascade, and streamed
 * export.
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LoggingService } from "../agent-client/logging";
import type { RequestContext } from "../agent-client/transport";

const CTX: RequestContext = {
  baseUrl: "http://drone.local:8080",
  apiKey: "test-key",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function envelope(data: unknown[], next: string | null = null, source = "logd") {
  return {
    data,
    page: { next_cursor: next, count: data.length },
    meta: { source, v: 1, ts: "2026-06-02T10:00:00+05:30", db_lag_ms: 7 },
  };
}

// Shape of the store's `LogRow` (crates/ados-logd/src/query/rows.rs).
const LOGD_ROW = {
  id: 1,
  ts_us: 1_780_000_000_000_000,
  session: null,
  source: "ados-video",
  level: "info",
  target: null,
  msg: "video started",
  fields: {},
  redacted: false,
};

describe("LoggingService transport resolution", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("serves from the proxy bridge on the agent REST port", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope([LOGD_ROW])));
    const svc = new LoggingService(CTX);
    const res = await svc.query();
    expect(res.meta.source).toBe("logd");
    expect(res.data).toHaveLength(1);
    expect(res.meta.db_lag_ms).toBe(7);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(":8080/api/v2/observability/v1/query");
    // Auth header carried.
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-ADOS-Key"]).toBe("test-key");
  });

  it("never dials the store's own query port, which a browser cannot read", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse([]));
    const svc = new LoggingService(CTX);
    await svc.query();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url] of fetchMock.mock.calls as [string][]) {
      expect(url).not.toContain(":8090");
    }
  });

  it("falls back to the legacy tier and normalises the flat array", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "x" }, 502)) // proxy
      .mockResolvedValueOnce(
        jsonResponse([
          { timestamp: "2026-06-02T09:59:00+05:30", level: "warn", logger: "api", msg: "slow" },
        ]),
      );
    const svc = new LoggingService(CTX);
    const res = await svc.query();
    expect(res.meta.source).toBe("legacy");
    expect(res.data).toHaveLength(1);
    const row = res.data[0];
    expect(row.level).toBe("warning"); // warn → warning
    expect(row.message).toBe("slow");
    expect(row.source).toBe("api"); // logger → source
    expect(typeof row.ts_us).toBe("number");
    const legacyUrl = fetchMock.mock.calls[1][0] as string;
    expect(legacyUrl).toContain(":8080/api/logs");
  });

  it("throws (does not cascade) on a hard 401 from the proxy tier", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "unauth" }, 401));
    const svc = new LoggingService(CTX);
    await expect(svc.query()).rejects.toThrow(/401/);
    // Only one call — no cascade past a hard error.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when every tier is unavailable", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503));
    const svc = new LoggingService(CTX);
    await expect(svc.query()).rejects.toThrow(/logd unavailable/);
  });

  it("cascades on a network error (rejected fetch)", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(jsonResponse([]));
    const svc = new LoggingService(CTX);
    const res = await svc.query();
    expect(res.meta.source).toBe("legacy");
  });

  it("retries the proxy first even after a call settled on legacy", async () => {
    // The legacy route answers any path, so once it has answered it must not
    // be tried ahead of the proxy, or a recovered proxy is never used again.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse([]));
    const svc = new LoggingService(CTX);
    expect((await svc.query()).meta.source).toBe("legacy");
    fetchMock.mockResolvedValueOnce(jsonResponse(envelope([LOGD_ROW], null, "proxy")));
    const res = await svc.query();
    expect(res.meta.source).toBe("proxy");
    const lastUrl = fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0] as string;
    expect(lastUrl).toContain("/api/v2/observability/v1/query");
  });
});

describe("LoggingService over a ground station's relay-proxy", () => {
  /** The relay client's baseUrl IS the relay-proxy prefix, not an origin. */
  const RELAY_CTX: RequestContext = {
    baseUrl:
      "http://192.168.1.50:8080/api/v1/ground-station/relay-proxy/0a1b2c3d4e5f",
    apiKey: "gs-key",
    relay: true,
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps the relay-proxy prefix instead of swapping to a port", async () => {
    // Port-swapping here would discard the prefix and dial the GROUND
    // STATION's own REST port, returning the ground station's logs labelled
    // as the drone's — a shipped surface reporting known-false data.
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const svc = new LoggingService(RELAY_CTX);
    await svc.query({ limit: 5 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(
      "/api/v1/ground-station/relay-proxy/0a1b2c3d4e5f/api/logs",
    );
    expect(url).toContain("limit=5");
    expect(url).not.toContain("observability");
  });

  it("probes exactly one tier — the radio carries only :8080/api", async () => {
    // The proxy tier would cost a full relay round trip before failing, so
    // it is never tried.
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    const svc = new LoggingService(RELAY_CTX);
    const res = await svc.query();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.meta.source).toBe("legacy");
  });

  it("refuses to open a tail rather than tailing the ground station", () => {
    const svc = new LoggingService(RELAY_CTX);
    expect(() =>
      svc.tail({}, { onRow: vi.fn(), onError: vi.fn() }),
    ).toThrow(/relay/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pushes through the relay prefix, never a rebuilt origin", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ pending: true, pushed: false }, 202));
    const svc = new LoggingService(RELAY_CTX);
    await svc.pushWindow({});
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(
      "http://192.168.1.50:8080/api/v1/ground-station/relay-proxy/0a1b2c3d4e5f/api/logs/push",
    );
  });
});

describe("LoggingService pagination + aggregate + export", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("walks every page of queryAll until the cursor is null", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(envelope([{ ...LOGD_ROW, id: 11 }], "cur1")))
      .mockResolvedValueOnce(jsonResponse(envelope([{ ...LOGD_ROW, id: 12 }], null)));
    const svc = new LoggingService(CTX);
    const ids: string[] = [];
    for await (const row of svc.queryAll()) ids.push(row.id);
    expect(ids).toEqual(["11", "12"]);
    // Second page carried the cursor.
    const secondUrl = fetchMock.mock.calls[1][0] as string;
    expect(secondUrl).toContain("cursor=cur1");
  });

  it("builds the aggregate query with repeated metric params", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        envelope([
          { bucket_us: 1, metric: "system.cpu_percent", value: 33, count: 4 },
        ]),
      ),
    );
    const svc = new LoggingService(CTX);
    const res = await svc.aggregate({
      metric: ["system.cpu_percent", "system.memory_percent"],
      bucket: "1m",
      agg: "avg",
    });
    expect(res.data).toHaveLength(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("metric=system.cpu_percent");
    expect(url).toContain("metric=system.memory_percent");
    expect(url).toContain("bucket=1m");
    expect(url).toContain("agg=avg");
  });

  it("returns an empty aggregate on a legacy agent rather than throwing", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 404)) // proxy
      .mockResolvedValueOnce(jsonResponse([])); // legacy
    const svc = new LoggingService(CTX);
    const res = await svc.aggregate({ metric: ["system.cpu_percent"] });
    expect(res.data).toEqual([]);
    expect(res.meta.source).toBe("legacy");
  });

  it("streams an export with the format suffix and never hits legacy", async () => {
    const body = '{"id":"x"}\n';
    fetchMock.mockResolvedValueOnce(
      new Response(body, { status: 200 }),
    );
    const svc = new LoggingService(CTX);
    const { stream, format } = await svc.export({ format: "jsonl" });
    expect(format).toBe("jsonl");
    const text = await new Response(stream).text();
    expect(text).toBe(body);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain(":8080/api/v2/observability/v1/export");
    expect(url).toContain("format=jsonl");
  });

  it("throws export unavailable when the proxy does not answer", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
    const svc = new LoggingService(CTX);
    await expect(svc.export()).rejects.toThrow(/export unavailable/);
    // Legacy has no export endpoint, so it is never asked.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces an auth refusal instead of reporting the export unavailable", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 401));
    const svc = new LoggingService(CTX);
    await expect(svc.export()).rejects.toThrow(/export refused: 401/);
  });

  describe("export inactivity deadline", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** A body whose chunks the test releases by hand. */
    function heldBody() {
      let push: (chunk: string) => void = () => undefined;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          push = (chunk) => c.enqueue(new TextEncoder().encode(chunk));
        },
      });
      return { stream, push: (chunk: string) => push(chunk) };
    }

    it("keeps a download alive while chunks keep arriving", async () => {
      const body = heldBody();
      fetchMock.mockResolvedValueOnce(new Response(body.stream, { status: 200 }));
      const { stream } = await new LoggingService(CTX).export();
      const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
      const reader = stream.getReader();
      // Four chunks, each 50 s apart: 200 s in total, well past the 60 s
      // idle bound, but never 60 s without data.
      for (let i = 0; i < 4; i += 1) {
        const read = reader.read();
        await vi.advanceTimersByTimeAsync(50_000);
        body.push(`row${i}\n`);
        expect((await read).done).toBe(false);
      }
      expect(signal.aborted).toBe(false);
    });

    it("aborts a download that stops sending", async () => {
      const body = heldBody();
      fetchMock.mockResolvedValueOnce(new Response(body.stream, { status: 200 }));
      const { stream } = await new LoggingService(CTX).export();
      const signal = (fetchMock.mock.calls[0][1] as RequestInit).signal!;
      void stream.getReader().read().catch(() => undefined);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(signal.aborted).toBe(true);
    });
  });
});

describe("LoggingService healthz", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns ok=false from healthz when no tier answers instead of throwing", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503));
    const svc = new LoggingService(CTX);
    const health = await svc.healthz();
    expect(health.ok).toBe(false);
  });
});
