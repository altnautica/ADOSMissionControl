/**
 * @module agent/agent-client/logging-wire
 * @description Maps the durable store's `/v1` wire shapes onto the typed rows
 * the GCS renders. The store serializes microsecond integers and its own field
 * names (`msg`, `started_us`, `bucket_us`, `detail`, a `warn` level, a stats
 * object inside the `data` envelope, an `integrity` string); every surface
 * that reads it goes through one of these functions so a consumer never sees
 * the wire names. Unknown or mistyped fields degrade to an absent value, never
 * to a fabricated one.
 * @license GPL-3.0-only
 */

import type {
  AggregatePoint,
  EventsRow,
  HWRow,
  LogLevel,
  LoggingKind,
  LoggingRow,
  MetricsRow,
  SessionRow,
  StatsResponse,
  HealthzResponse,
} from "./logging";

type Obj = Record<string, unknown>;

function asObj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function idString(v: unknown): string | null {
  if (typeof v === "string" && v !== "") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Microsecond epoch to ISO-8601; empty string when the value is unusable. */
export function usToIso(us: number | null): string {
  if (us === null) return "";
  const d = new Date(Math.floor(us / 1000));
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** The store's level names (`trace`..`error`, `warn`) folded onto the four
 * levels the GCS renders. */
export function toLogLevel(v: unknown): LogLevel {
  const lv = String(v ?? "info").toLowerCase();
  if (lv === "warn" || lv === "warning") return "warning";
  if (lv === "trace" || lv === "debug") return "debug";
  if (lv === "error" || lv === "err" || lv === "critical" || lv === "fatal") {
    return "error";
  }
  return "info";
}

function numberMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(asObj(v))) {
    const n = num(raw);
    if (n !== null) out[k] = n;
  }
  return out;
}

/** One log row: `/v1/query?kind=logs` rows and the tail's `kind:"log"`
 * frames. A live tail frame carries no `id`, so one is derived from the
 * timestamp and the frame's position. */
export function normaliseLogRow(raw: unknown, idx = 0): LoggingRow {
  const r = asObj(raw);
  const tsUs = num(r.ts_us) ?? 0;
  const session = idString(r.session);
  const fields = asObj(r.fields);
  return {
    ts: usToIso(tsUs),
    ts_us: tsUs,
    id: idString(r.id) ?? `tail-${tsUs}-${idx}`,
    level: toLogLevel(r.level),
    message: typeof r.msg === "string" ? r.msg : "",
    source: typeof r.source === "string" ? r.source : "",
    ...(session !== null ? { session } : {}),
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  };
}

/** One event row (`kind=events`). The tail names the classifier `event_kind`;
 * the query row names it `kind`. */
export function normaliseEventRow(raw: unknown): EventsRow {
  const r = asObj(raw);
  const tsUs = num(r.ts_us) ?? 0;
  const kind =
    typeof r.event_kind === "string"
      ? r.event_kind
      : typeof r.kind === "string"
        ? r.kind
        : "";
  return {
    ts: usToIso(tsUs),
    ts_us: tsUs,
    kind,
    data: asObj(r.detail),
    ...(typeof r.source === "string" ? { source: r.source } : {}),
    ...(typeof r.severity === "string" ? { severity: toLogLevel(r.severity) } : {}),
  };
}

export function normaliseMetricRow(raw: unknown): MetricsRow {
  const r = asObj(raw);
  const tsUs = num(r.ts_us) ?? 0;
  const tags: Record<string, string> = {};
  for (const [k, v] of Object.entries(asObj(r.tags))) tags[k] = String(v);
  return {
    ts: usToIso(tsUs),
    ts_us: tsUs,
    metric: typeof r.metric === "string" ? r.metric : "",
    value: num(r.value) ?? Number.NaN,
    tags,
  };
}

export function normaliseHwRow(raw: unknown): HWRow {
  const r = asObj(raw);
  const tsUs = num(r.ts_us) ?? 0;
  return { ts: usToIso(tsUs), ts_us: tsUs, signals: asObj(r.signals) };
}

/** Route one `/v1/query` row to the normaliser for the table it came from. */
export function normaliseQueryRow(kind: LoggingKind, raw: unknown, idx: number): unknown {
  switch (kind) {
    case "logs":
      return normaliseLogRow(raw, idx);
    case "events":
      return normaliseEventRow(raw);
    case "metrics":
      return normaliseMetricRow(raw);
    case "hw":
      return normaliseHwRow(raw);
  }
}

export function normaliseSessionRow(raw: unknown): SessionRow {
  const r = asObj(raw);
  const startedUs = num(r.started_us);
  const endedUs = num(r.ended_us);
  const spanUs = num(r.span_us);
  const kind = r.kind === "flight" || r.kind === "manual" ? r.kind : "boot";
  return {
    id: idString(r.id) ?? "",
    started: usToIso(startedUs),
    ended: endedUs === null ? null : usToIso(endedUs),
    kind,
    ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
    meta: asObj(r.meta),
    log_count: num(r.log_count) ?? 0,
    event_count: num(r.event_count) ?? 0,
    duration_ms: spanUs === null ? null : spanUs / 1000,
  };
}

export function normaliseBucket(raw: unknown): AggregatePoint {
  const r = asObj(raw);
  const tsUs = num(r.bucket_us) ?? 0;
  return {
    ts: usToIso(tsUs),
    ts_us: tsUs,
    metric: typeof r.metric === "string" ? r.metric : "",
    value: num(r.value) ?? Number.NaN,
    count: num(r.count) ?? 0,
  };
}

/** `/v1/stats` answers the shared envelope with the stats object as `data`. */
export function normaliseStats(body: unknown): Omit<StatsResponse, "source"> {
  const s = asObj(asObj(body).data);
  const integrity = typeof s.integrity === "string" ? s.integrity : "";
  return {
    db: {
      size_bytes: num(s.db_size_bytes) ?? 0,
      wal_size_bytes: num(s.wal_size_bytes) ?? 0,
      row_counts: numberMap(s.rows),
      integrity: integrity === "ok",
      integrity_detail: integrity,
      schema_version: num(s.schema_version),
    },
    ingest: {
      accepted: num(s.ingest_accepted) ?? 0,
      dropped: numberMap(s.ingest_dropped),
    },
    sync: { unsynced_rows: numberMap(s.unsynced) },
    oldest_ts_us: num(s.oldest_ts_us),
    newest_ts_us: num(s.newest_ts_us),
  };
}

/** `/v1/healthz` answers a bare object; `integrity` is `"ok"` when healthy. */
export function normaliseHealth(body: unknown): Omit<HealthzResponse, "source"> {
  const b = asObj(body);
  return {
    ok: b.ok === true,
    db_open: b.db_open === true,
    writer_alive: b.writer_alive === true,
    integrity: b.integrity === "ok",
  };
}
