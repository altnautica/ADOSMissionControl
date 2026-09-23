/**
 * @module mock/agent/logging
 * @description Demo-mode stand-in for the durable log/telemetry store
 * reader. Replays the same mock service log timeline through the
 * `LoggingService` envelope shape, synthesises a couple of sessions, and
 * feeds the CPU/memory aggregate so the ADOS Black Box view renders fully
 * in `npm run demo`. The `tail()` method drives the handler-based tail
 * contract from an interval: it emits a few rows, then drips one every few
 * seconds, so the live LogViewer works without a real `:8090` endpoint.
 * @license GPL-3.0-only
 */

import type {
  AggregateParams,
  AggregatePoint,
  EventsRow,
  ExportFormat,
  ExportParams,
  HealthzResponse,
  LoggingEnvelope,
  LoggingRow,
  LogTail,
  LogTailHandlers,
  QueryParams,
  SessionListParams,
  SessionRow,
  StatsResponse,
  TailParams,
} from "@/lib/agent/agent-client/logging";
import { MOCK_LOGS } from "./logs";

/** Demo-mode radio/network event timeline, replayed when the Radio /
 * Network Health panel queries `kind=events` by the radio/network kinds.
 * Mirrors a realistic first-boot sequence: a boot-window reg re-pin, a
 * bind, a transient RF-unverified entry that then clears, and an
 * onboard-WiFi self-heal. Timestamps are computed at module load so the
 * feed reads "minutes ago" in the running demo. */
function mockRadioNetworkEvents(): EventsRow[] {
  const now = Date.now();
  const at = (msAgo: number) => ({
    ts: new Date(now - msAgo).toISOString(),
    ts_us: (now - msAgo) * 1000,
  });
  return [
    {
      ...at(180_000),
      kind: "radio.reg_reasserted",
      data: {
        from_country: "BO",
        to_country: "US",
        wfb_channel: 149,
        channel_permitted: true,
        source: "boot",
      },
    },
    {
      ...at(150_000),
      kind: "radio.reg_gate",
      data: {
        stage: "bind",
        band: "u-nii-3",
        channel: 149,
        requested_country: "US",
        applied_country: "US",
        eeprom_override: false,
        result: "allowed",
        reason: "channel permitted",
      },
    },
    {
      ...at(120_000),
      kind: "radio.bind",
      data: { channel: 149 },
    },
    {
      ...at(90_000),
      kind: "radio.rf_unverified",
      data: {
        state: "entry",
        iface: "wlan1",
        tx_rate: 54,
        rx_rate: 0,
        usb_speed_mbps: 480,
      },
    },
    {
      ...at(72_000),
      kind: "network.wifi_reassociated",
      data: {
        interface: "wlan0",
        connection: "home-5g",
        gateway: null,
        consecutive_failures: 2,
      },
    },
    {
      ...at(45_000),
      kind: "radio.rf_unverified",
      data: {
        state: "clear",
        iface: "wlan1",
        tx_rate: 54,
        rx_rate: 6,
        usb_speed_mbps: 480,
      },
    },
    {
      ...at(20_000),
      kind: "radio.bind_failed",
      data: { reason: "no_peer", channel: 161 },
    },
  ];
}

function toRows(): LoggingRow[] {
  return MOCK_LOGS.map((e, i) => {
    const tsMs = Date.parse(e.timestamp);
    return {
      ts: e.timestamp,
      ts_us: (Number.isFinite(tsMs) ? tsMs : Date.now()) * 1000,
      id: `mock-${i}`,
      level: e.level,
      message: e.message,
      source: e.service,
      session: "boot-1",
    };
  });
}

const ROWS = toRows();

/** An interval-backed tail, so the LogViewer's tail wiring exercises the same
 * handler contract in demo mode. */
function mockTail(replay: number, handlers: LogTailHandlers): LogTail {
  let idx = 0;
  let closed = false;
  // Replay the tail of the timeline immediately, then drip new lines.
  const start = Math.max(0, ROWS.length - replay);
  queueMicrotask(() => {
    for (let i = start; i < ROWS.length && !closed; i++) handlers.onRow(ROWS[i]);
  });
  const timer = setInterval(() => {
    const base = ROWS[idx % ROWS.length];
    idx += 1;
    handlers.onRow({
      ...base,
      id: `mock-live-${idx}`,
      ts: new Date().toISOString(),
      ts_us: Date.now() * 1000,
    });
  }, 3000);
  return {
    close() {
      closed = true;
      clearInterval(timer);
    },
  };
}

export class MockLoggingService {
  resetTier(): void {
    /* no-op in demo */
  }

  get resolvedSource(): "logd" {
    return "logd";
  }

  async query<T = LoggingRow>(
    params: QueryParams = {},
  ): Promise<LoggingEnvelope<T>> {
    // Events table (kind=events): replay the radio/network timeline,
    // filtered by the requested event kinds, so the Radio / Network Health
    // panel renders a populated activity feed in demo mode.
    if (params.kind === "events") {
      let events = mockRadioNetworkEvents();
      if (params.event_kind && params.event_kind.length > 0) {
        const wanted = new Set(params.event_kind);
        events = events.filter((e) => wanted.has(e.kind));
      }
      const sortedEvents = [...events].sort((a, b) => b.ts_us - a.ts_us);
      const limitedEvents = params.cursor
        ? []
        : sortedEvents.slice(0, params.limit ?? 200);
      return {
        data: limitedEvents as unknown as T[],
        page: { next_cursor: null, count: limitedEvents.length },
        meta: { source: "logd", v: 1, ts: new Date().toISOString(), db_lag_ms: 0 },
      };
    }
    let rows = ROWS;
    if (params.level) {
      const order = ["debug", "info", "warning", "error"];
      const min = order.indexOf(params.level.toLowerCase());
      if (min >= 0) rows = rows.filter((r) => order.indexOf(r.level) >= min);
    }
    if (params.text) {
      const q = params.text.toLowerCase();
      rows = rows.filter((r) => r.message.toLowerCase().includes(q));
    }
    if (params.session) rows = rows.filter((r) => r.session === params.session);
    // Newest first, one page (no real cursor in demo).
    const sorted = [...rows].sort((a, b) => b.ts_us - a.ts_us);
    const limited = params.cursor ? [] : sorted.slice(0, params.limit ?? 200);
    return {
      data: limited as unknown as T[],
      page: { next_cursor: null, count: limited.length },
      meta: { source: "logd", v: 1, ts: new Date().toISOString(), db_lag_ms: 0 },
    };
  }

  async *queryAll<T = LoggingRow>(
    params: QueryParams = {},
  ): AsyncGenerator<T, void, void> {
    const page = await this.query<T>(params);
    for (const row of page.data) yield row;
  }

  tail(params: TailParams, handlers: LogTailHandlers): LogTail {
    return mockTail(params.replay ?? 50, handlers);
  }

  async aggregate(
    params: AggregateParams,
  ): Promise<LoggingEnvelope<AggregatePoint>> {
    const now = Date.now();
    const points: AggregatePoint[] = [];
    // 120 points over the last 10 minutes, per requested metric.
    for (const metric of params.metric) {
      for (let i = 119; i >= 0; i--) {
        const tsMs = now - i * 5000;
        const base = metric.includes("cpu") ? 34 : metric.includes("mem") ? 31 : 50;
        points.push({
          ts: new Date(tsMs).toISOString(),
          ts_us: tsMs * 1000,
          metric,
          value: base + Math.sin(i / 8) * 6,
          count: 5,
        });
      }
    }
    return {
      data: points,
      page: { next_cursor: null, count: points.length },
      meta: { source: "logd", v: 1, ts: new Date().toISOString(), db_lag_ms: 0 },
    };
  }

  async sessions(
    _params: SessionListParams = {},
  ): Promise<LoggingEnvelope<SessionRow>> {
    const now = Date.now();
    const data: SessionRow[] = [
      {
        id: "boot-1",
        started: new Date(now - 30 * 60_000).toISOString(),
        ended: null,
        kind: "boot",
        reason: "power on",
        log_count: ROWS.length,
        event_count: 4,
        duration_ms: null,
      },
      {
        id: "flight-3",
        started: new Date(now - 90 * 60_000).toISOString(),
        ended: new Date(now - 70 * 60_000).toISOString(),
        kind: "flight",
        reason: "armed",
        log_count: 412,
        event_count: 9,
        duration_ms: 20 * 60_000,
      },
    ];
    return {
      data,
      page: { next_cursor: null, count: data.length },
      meta: { source: "logd", v: 1, ts: new Date().toISOString(), db_lag_ms: 0 },
    };
  }

  async export(params: ExportParams = {}): Promise<{
    stream: ReadableStream<Uint8Array>;
    format: ExportFormat;
    source: "logd";
  }> {
    const format = params.format ?? "jsonl";
    const body = ROWS.map((r) => JSON.stringify(r)).join("\n");
    const bytes = new TextEncoder().encode(body);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    return { stream, format: format === "jsonl.zst" ? "jsonl" : format, source: "logd" };
  }

  async stats(): Promise<StatsResponse> {
    return {
      db: {
        size_bytes: 18_400_000,
        wal_size_bytes: 1_200_000,
        row_counts: { logs: ROWS.length, metrics: 8400, events: 12, hw: 3600 },
        integrity: true,
        integrity_detail: "ok",
        schema_version: 1,
      },
      ingest: { accepted: 12_000 + ROWS.length, dropped: {} },
      sync: { unsynced_rows: { logs: ROWS.length, metrics: 8400, events: 12, hw: 3600 } },
      oldest_ts_us: ROWS.length > 0 ? Math.min(...ROWS.map((r) => r.ts_us)) : null,
      newest_ts_us: ROWS.length > 0 ? Math.max(...ROWS.map((r) => r.ts_us)) : null,
      source: "logd",
    };
  }

  async healthz(): Promise<HealthzResponse> {
    return {
      ok: true,
      db_open: true,
      writer_alive: true,
      integrity: true,
      source: "logd",
    };
  }
}
