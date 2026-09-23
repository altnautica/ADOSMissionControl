/**
 * @module logging-contract.test
 * @description Pins the durable-store client to the store's serialized wire
 * shapes. Every fixture is a JSON literal of the Rust struct it names, so a
 * client that reads a field the store does not send fails here rather than
 * rendering blanks against a real agent.
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { LoggingService, type LoggingRow } from "../agent-client/logging";
import type { RequestContext } from "../agent-client/transport";

const CTX: RequestContext = { baseUrl: "http://192.168.1.50:8080", apiKey: "k-1" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** ados-protocol `QueryResponse` envelope with `Meta.ts` as a µs epoch. */
function envelope(data: unknown) {
  return {
    data,
    page: { next_cursor: null, count: Array.isArray(data) ? data.length : 1 },
    meta: { source: "logd", v: 1, ts: 1_780_000_000_500_000, db_lag_ms: 3 },
  };
}

const TS_US = 1_780_000_000_000_000;
const TS_ISO = new Date(TS_US / 1000).toISOString();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("durable-store wire contract", () => {
  it("maps rows.rs LogRow onto LoggingRow", async () => {
    // rows.rs LogRow
    const wire = {
      id: 42,
      ts_us: TS_US,
      session: 7,
      source: "ados-video",
      level: "warn",
      target: "ados_video::pipeline",
      msg: "encoder restarted",
      fields: { attempt: 2 },
      redacted: false,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(envelope([wire]))));
    const res = await new LoggingService(CTX).query();
    expect(res.data[0]).toEqual({
      ts: TS_ISO,
      ts_us: TS_US,
      id: "42",
      level: "warning",
      message: "encoder restarted",
      source: "ados-video",
      session: "7",
      fields: { attempt: 2 },
    });
    expect(res.meta.ts).toBe(new Date(1_780_000_000_500).toISOString());
  });

  it("maps rows.rs EventRow detail onto EventsRow data", async () => {
    // rows.rs EventRow
    const wire = {
      id: 3,
      ts_us: TS_US,
      session: null,
      kind: "radio.bind_failed",
      source: "ados-wfb",
      severity: "error",
      detail: { reason: "no_peer", channel: 161 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(envelope([wire]))));
    const res = await new LoggingService(CTX).query({ kind: "events" });
    expect(res.data[0]).toEqual({
      ts: TS_ISO,
      ts_us: TS_US,
      kind: "radio.bind_failed",
      data: { reason: "no_peer", channel: 161 },
      source: "ados-wfb",
      severity: "error",
    });
  });

  it("maps rows.rs SessionRow microsecond fields", async () => {
    // rows.rs SessionRow: one closed session and one still open.
    const wire = [
      {
        id: 9,
        started_us: TS_US,
        ended_us: TS_US + 90_000_000,
        kind: "flight",
        reason: "armed",
        meta: {},
        log_count: 412,
        event_count: 9,
        span_us: 90_000_000,
      },
      {
        id: 10,
        started_us: TS_US,
        ended_us: null,
        kind: "boot",
        reason: null,
        meta: null,
        log_count: 5,
        event_count: 0,
        span_us: null,
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(envelope(wire))));
    const res = await new LoggingService(CTX).sessions();
    expect(res.data[0]).toMatchObject({
      id: "9",
      started: TS_ISO,
      ended: new Date(TS_US / 1000 + 90_000).toISOString(),
      kind: "flight",
      duration_ms: 90_000,
    });
    expect(res.data[1]).toMatchObject({ id: "10", ended: null, duration_ms: null });
  });

  it("maps aggregate.rs Bucket bucket_us onto the point time", async () => {
    // aggregate.rs Bucket
    const wire = { bucket_us: TS_US, metric: "system.cpu_percent", value: 33.5, count: 12 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(envelope([wire]))));
    const res = await new LoggingService(CTX).aggregate({ metric: ["system.cpu_percent"] });
    expect(res.data[0]).toEqual({
      ts: TS_ISO,
      ts_us: TS_US,
      metric: "system.cpu_percent",
      value: 33.5,
      count: 12,
    });
  });

  it("unwraps stats.rs Stats from the envelope", async () => {
    // stats.rs Stats, served inside the shared envelope's `data`.
    const wire = {
      db_size_bytes: 5_242_880,
      wal_size_bytes: 65_536,
      schema_version: 3,
      integrity: "ok",
      rows: { logs: 1200, events: 40 },
      oldest_ts_us: TS_US - 1_000_000,
      newest_ts_us: TS_US,
      ingest_accepted: 9001,
      ingest_dropped: { log: 2, telemetry: 0 },
      unsynced: { logs: 1100 },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(envelope(wire))));
    const stats = await new LoggingService(CTX).stats();
    expect(stats).toEqual({
      db: {
        size_bytes: 5_242_880,
        wal_size_bytes: 65_536,
        row_counts: { logs: 1200, events: 40 },
        integrity: true,
        integrity_detail: "ok",
        schema_version: 3,
      },
      ingest: { accepted: 9001, dropped: { log: 2, telemetry: 0 } },
      sync: { unsynced_rows: { logs: 1100 } },
      oldest_ts_us: TS_US - 1_000_000,
      newest_ts_us: TS_US,
      source: "proxy",
    });
  });

  it("reads stats.rs Health integrity as the string ok", async () => {
    // stats.rs Health
    const wire = { ok: true, db_open: true, writer_alive: true, integrity: "ok" };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(wire)));
    const health = await new LoggingService(CTX).healthz();
    expect(health).toEqual({
      ok: true,
      db_open: true,
      writer_alive: true,
      integrity: true,
      source: "proxy",
    });
  });
});

describe("live log tail", () => {
  function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const c of chunks) controller.enqueue(enc.encode(c));
        controller.close();
      },
    });
  }

  it("sends the key as a header, never in the URL, and maps sse.rs frames", async () => {
    // Replay row (rows.rs LogRow), a lag notice, a keep-alive comment, a live
    // metric frame, and a live log frame (sse.rs frame_to_json), split across
    // chunk boundaries the way a socket delivers them.
    const replay = JSON.stringify({
      id: 5, ts_us: TS_US, session: null, source: "api", level: "info",
      target: null, msg: "replayed", fields: {}, redacted: false,
    });
    const live = JSON.stringify({
      kind: "log", ts_us: TS_US + 1, source: "ados-video", level: "error",
      target: null, msg: "live line", fields: {},
    });
    const metric = JSON.stringify({ kind: "metric", ts_us: TS_US, metric: "x", value: 1, tags: {} });
    const body = [
      `data: ${replay}\n\n`,
      `event: lagged\ndata: {"kind":"lagged","dropped":4}\n\n:keep-alive\n\n`,
      `data: ${metric}\n\ndata: ${live.slice(0, 20)}`,
      `${live.slice(20)}\n\n`,
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(sseBody(body), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const rows: LoggingRow[] = [];
    const ended = Promise.withResolvers<Error>();
    new LoggingService(CTX).tail(
      { replay: 10 },
      { onRow: (r) => rows.push(r), onError: ended.resolve },
    );
    await ended.promise;

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(":8080/api/v2/observability/v1/tail?");
    expect(url).not.toContain("k-1");
    expect(url).not.toMatch(/[?&]key=/);
    expect((init.headers as Record<string, string>)["X-ADOS-Key"]).toBe("k-1");
    expect(rows.map((r) => [r.message, r.level, r.source])).toEqual([
      ["replayed", "info", "api"],
      ["live line", "error", "ados-video"],
    ]);
  });

  it("reports a refused tail through onError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ error: {} }, 401)));
    const failed = Promise.withResolvers<Error>();
    new LoggingService(CTX).tail({}, { onRow: vi.fn(), onError: failed.resolve });
    expect((await failed.promise).message).toMatch(/401/);
  });

  it("never reports after close", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({}, 503)));
      const onError = vi.fn();
      const tail = new LoggingService(CTX).tail({}, { onRow: vi.fn(), onError });
      tail.close();
      // Settles the refused response and passes the connect deadline.
      await vi.runAllTimersAsync();
      expect(onError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up when the response headers never arrive", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>(() => {})));
      const onError = vi.fn();
      new LoggingService({ ...CTX, defaultTimeoutMs: 5000 }).tail({}, { onRow: vi.fn(), onError });
      await vi.advanceTimersByTimeAsync(4999);
      expect(onError).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(onError).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
