/**
 * @module agent/agent-client/logging
 * @description The `LoggingService` domain module. Reads the durable
 * on-device log/telemetry/event/hardware store over the LAN and surfaces
 * it through a single typed client. Transport resolution is local-first
 * and three-tier, which is also the dual-run feature flag:
 *
 *   1. LAN-direct   http://<host>:8090/v1/...            (primary)
 *   2. proxy        http://<host>:8080/api/v2/observability/v1/...
 *   3. legacy       http://<host>:8080/api/logs          (older agents)
 *
 * Once a tier answers, subsequent calls try it first and only cascade
 * to the next tier on a service-unavailable signal (404 / 502 / 503 /
 * network error). Bad-request / auth / rate-limit responses (400 / 401 /
 * 403 / 429) do NOT cascade — they are surfaced as the real error.
 *
 * Every successful response is normalised to one envelope shape so a
 * caller never has to know which tier answered. The legacy tier (a flat
 * array of `{ timestamp, level, logger, msg }`) is mapped into the same
 * row + envelope shape on the fly, so older agents keep working with no
 * branch at the call site.
 * @license GPL-3.0-only
 */

// Exempt from 300 LOC soft rule: self-contained agent protocol client.

import type { RequestContext } from "./transport";
import { AGENT_FETCH_TIMEOUT_MS, timedFetch } from "./timeout";

// ── Row shapes ────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warning" | "error";

/** A single log row from the durable store (`kind=logs`). */
export interface LoggingRow {
  /** ISO-8601 (with offset) server-rendered timestamp. */
  ts: string;
  /** Microseconds since the epoch — the keyset sort key. */
  ts_us: number;
  /** Stable per-row id (second half of the keyset key). */
  id: string;
  level: LogLevel;
  message: string;
  /** Producer source (e.g. `ados-video`, `api`). */
  source: string;
  /** Owning session id, when the row was captured inside one. */
  session?: string;
  /** Structured fields attached to the row, redacted at the source. */
  fields?: Record<string, unknown>;
}

/** A downsampled metric sample (`kind=metrics`). */
export interface MetricsRow {
  ts: string;
  ts_us: number;
  metric: string;
  value: number;
  tags?: Record<string, string>;
}

/** A discrete event row (`kind=events`). */
export interface EventsRow {
  ts: string;
  ts_us: number;
  kind: string;
  data?: Record<string, unknown>;
}

/** A hardware-sample row (`kind=hw`). */
export interface HWRow {
  ts: string;
  ts_us: number;
  hwclass: string;
  fields: Record<string, number>;
}

/** A boot / flight / manual session. */
export interface SessionRow {
  id: string;
  /** ISO-8601 (with offset). */
  started: string;
  /** ISO-8601 (with offset), or null while the session is still open. */
  ended: string | null;
  kind: "boot" | "flight" | "manual";
  reason?: string;
  meta?: Record<string, unknown>;
  log_count: number;
  event_count: number;
  duration_ms: number;
}

/** One bucketed aggregate point. `metric` + `value` plus the bucket time. */
export interface AggregatePoint {
  ts: string;
  ts_us: number;
  metric: string;
  value: number;
  tags?: Record<string, string>;
}

// ── Request param shapes ──────────────────────────────────────────────

export type LoggingKind = "logs" | "events" | "metrics" | "hw";

export interface QueryParams {
  /** ISO-8601 or relative (`-5m`, `-2h`). */
  from?: string;
  to?: string;
  /** Which table to read. Defaults to `logs` on the server. */
  kind?: LoggingKind;
  /** One or more producer sources. */
  source?: string[];
  /** Minimum level (name or ordinal) for `logs` / `events`. */
  level?: string;
  /** One or more dotted metric keys for `kind=metrics`. */
  metric?: string[];
  /** One or more event kinds for `kind=events`. */
  event_kind?: string[];
  /** Substring match on the message / target. */
  text?: string;
  /** Restrict to one session id. */
  session?: string;
  /** Page size (server-capped). */
  limit?: number;
  /** Opaque keyset cursor from a prior `page.next_cursor`. */
  cursor?: string;
}

export type AggregateBucket = "auto" | "1s" | "1m" | "1h";
export type AggregateAgg =
  | "avg"
  | "min"
  | "max"
  | "p50"
  | "p95"
  | "last"
  | "count";

export interface AggregateParams {
  metric: string[];
  from?: string;
  to?: string;
  session?: string;
  bucket?: AggregateBucket;
  agg?: AggregateAgg;
  group_by?: string[];
}

export type ExportFormat = "jsonl" | "jsonl.zst";

export interface ExportParams extends QueryParams {
  format?: ExportFormat;
}

/** Selector for an explicit, operator-triggered cloud export of a chosen
 * window. Same vocabulary as a query: a session and/or a closed time range
 * scope the rows; the format defaults to `jsonl.zst`. */
export interface PushParams {
  from?: string;
  to?: string;
  kind?: LoggingKind;
  source?: string[];
  level?: string;
  text?: string;
  session?: string;
  format?: ExportFormat;
}

/** The agent's canonical acknowledgement for one pushed window. */
export interface PushResult {
  /** Cloud record id for the stored window. */
  window_id: string;
  /** Server-recomputed sha256 of the uploaded bytes, hex. */
  sha256: string;
  /** Byte size of the uploaded window. */
  bytes: number;
  /** Row count in the window. */
  rows: number;
  /** True when the same content was already stored (no new copy made). */
  deduped: boolean;
  /** True when the on-device rows were marked as exported. */
  synced: boolean;
}

export interface SessionListParams {
  from?: string;
  to?: string;
  kind?: SessionRow["kind"];
  /** Only sessions still open. */
  open?: boolean;
  limit?: number;
  cursor?: string;
}

export interface TailParams extends QueryParams {
  /** On connect, replay the last N matching rows before the live tail. */
  replay?: number;
}

// ── Response shapes ───────────────────────────────────────────────────

/** Which tier answered a request. */
export type LoggingSource = "logd" | "proxy" | "legacy";

export interface LoggingEnvelope<T> {
  data: T[];
  page: {
    next_cursor: string | null;
    count: number;
  };
  meta: {
    source: LoggingSource;
    /** Envelope version. */
    v: number;
    /** Server time, ISO-8601 (with offset). */
    ts: string;
    /** WAL read-lag in milliseconds. */
    db_lag_ms: number;
  };
}

export interface StatsResponse {
  db: {
    file_size_mb: number;
    wal_size_mb: number;
    row_counts: Record<string, number>;
    integrity?: boolean;
    user_version?: number;
  };
  ingest: {
    rows_per_sec: number;
    drops: Record<string, number>;
    queue_depth: number;
    last_batch_latency_ms?: number;
  };
  sync: {
    /** Rows still pending an explicit push, per table. */
    pending_rows?: Record<string, number>;
    synced_rows: number;
    last_push_time: string | null;
  };
  /** Which tier answered the stats call (so the UI can show a degraded badge). */
  source: LoggingSource;
}

export interface HealthzResponse {
  ok: boolean;
  db_open: boolean;
  writer_alive: boolean;
  integrity: boolean;
  source: LoggingSource;
}

// ── Tier resolution ───────────────────────────────────────────────────

/** Listener ports/paths. `:8090` is the dedicated query port; the proxy
 * bridge is mounted under FastAPI at `:8080`. */
const LOGD_PORT = 8090;
const FASTAPI_PORT = 8080;
const PROXY_PREFIX = "/api/v2/observability";

/** Deadline for the streaming export + the cloud-push write. Far above the
 * per-read default (`AGENT_FETCH_TIMEOUT_MS`) so a legitimately large
 * window has room to drain, while still guarding against a half-open
 * socket that would otherwise hang the call forever. */
const EXPORT_TIMEOUT_MS = AGENT_FETCH_TIMEOUT_MS * 10;

type Tier = "direct" | "proxy" | "legacy";

const TIER_ORDER: readonly Tier[] = ["direct", "proxy", "legacy"];

const TIER_SOURCE: Record<Tier, LoggingSource> = {
  direct: "logd",
  proxy: "proxy",
  legacy: "legacy",
};

/** HTTP statuses that mean "this tier cannot serve this surface" and so
 * justify cascading to the next tier. A 502 is included because the
 * FastAPI proxy returns it when the logd socket is down. */
const CASCADE_STATUSES = new Set([404, 501, 502, 503]);

/** Statuses that are real errors for the request, not a missing surface:
 * never cascade on these, surface the error instead. */
function isHardError(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 429;
}

class TierUnavailableError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = "TierUnavailableError";
  }
}

class TierHardError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TierHardError";
  }
}

/** Build the base origin for a tier from the agent's REST base URL. The
 * host is taken from `ctx.baseUrl` (which already carries the resolved
 * hostname/IP) and only the port + path prefix change per tier.
 *
 * Under relay there is no port to swap: `ctx.baseUrl` is the ground
 * station's relay-proxy prefix, and only `:8080/api/...` traverses the
 * radio. Rebuilding an origin here would discard the prefix and dial the
 * GROUND STATION's `:8090`, returning the ground station's own logs labelled
 * as the drone's. So the relay pins the legacy shape and returns the prefix
 * verbatim — no `new URL()`, no port surgery. */
function tierBase(
  ctx: RequestContext,
  tier: Tier,
): { origin: string; prefix: string } {
  if (ctx.relay) {
    return { origin: ctx.baseUrl, prefix: "/api/logs" };
  }
  const u = new URL(ctx.baseUrl);
  const proto = u.protocol; // http: on LAN; https: cloud origins won't take this path
  const host = u.hostname;
  switch (tier) {
    case "direct":
      return { origin: `${proto}//${host}:${LOGD_PORT}`, prefix: "/v1" };
    case "proxy":
      return { origin: `${proto}//${host}:${FASTAPI_PORT}`, prefix: `${PROXY_PREFIX}/v1` };
    case "legacy":
      return { origin: `${proto}//${host}:${FASTAPI_PORT}`, prefix: "/api/logs" };
  }
}

function appendList(qs: URLSearchParams, key: string, vals?: string[]): void {
  if (!vals) return;
  for (const v of vals) {
    if (v != null && v !== "") qs.append(key, v);
  }
}

function buildQueryString(params: QueryParams): string {
  const qs = new URLSearchParams();
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  if (params.kind) qs.set("kind", params.kind);
  if (params.level) qs.set("level", params.level);
  if (params.text) qs.set("text", params.text);
  if (params.session) qs.set("session", params.session);
  if (params.limit != null) qs.set("limit", String(params.limit));
  if (params.cursor) qs.set("cursor", params.cursor);
  appendList(qs, "source", params.source);
  appendList(qs, "metric", params.metric);
  appendList(qs, "event_kind", params.event_kind);
  return qs.toString();
}

// ── Legacy normalisation ──────────────────────────────────────────────

/** Coerce one legacy `/api/logs` entry to a `LoggingRow`. The legacy
 * surface emits `{ timestamp, level, logger|service, msg|message }`. */
function normaliseLegacyRow(raw: unknown, idx: number): LoggingRow {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ts =
    typeof r.timestamp === "string"
      ? r.timestamp
      : typeof r.ts === "string"
        ? r.ts
        : new Date().toISOString();
  const tsMs = Date.parse(ts);
  const level = ((): LogLevel => {
    const lv = String(r.level ?? "info").toLowerCase();
    if (lv === "debug" || lv === "info" || lv === "warning" || lv === "error") {
      return lv;
    }
    if (lv === "warn") return "warning";
    if (lv === "err" || lv === "critical" || lv === "fatal") return "error";
    return "info";
  })();
  return {
    ts,
    ts_us: Number.isFinite(tsMs) ? tsMs * 1000 : 0,
    // Legacy rows have no stable id; synthesise a deterministic-enough one
    // from the timestamp + position so React keys stay stable within a page.
    id: typeof r.id === "string" ? r.id : `legacy-${tsMs || 0}-${idx}`,
    level,
    message: String(r.message ?? r.msg ?? ""),
    source: String(r.source ?? r.service ?? r.logger ?? "agent"),
  };
}

function wrapLegacy(rows: unknown[]): LoggingEnvelope<LoggingRow> {
  const data = rows.map((r, i) => normaliseLegacyRow(r, i));
  return {
    data,
    page: { next_cursor: null, count: data.length },
    meta: {
      source: "legacy",
      v: 1,
      ts: new Date().toISOString(),
      db_lag_ms: 0,
    },
  };
}

/** Coerce a raw `/v1` JSON body into the typed envelope, tolerating the
 * agent shipping extra fields ahead of the client. */
function asEnvelope<T>(body: unknown, source: LoggingSource): LoggingEnvelope<T> {
  const b = (body ?? {}) as Record<string, unknown>;
  const data = Array.isArray(b.data) ? (b.data as T[]) : [];
  const page = (b.page ?? {}) as Record<string, unknown>;
  const meta = (b.meta ?? {}) as Record<string, unknown>;
  return {
    data,
    page: {
      next_cursor:
        typeof page.next_cursor === "string" ? page.next_cursor : null,
      count: typeof page.count === "number" ? page.count : data.length,
    },
    meta: {
      // Trust the server's own `source` when present; else attribute to the
      // tier that answered.
      source:
        meta.source === "logd" || meta.source === "proxy" || meta.source === "legacy"
          ? (meta.source as LoggingSource)
          : source,
      v: typeof meta.v === "number" ? meta.v : 1,
      ts: typeof meta.ts === "string" ? meta.ts : new Date().toISOString(),
      db_lag_ms: typeof meta.db_lag_ms === "number" ? meta.db_lag_ms : 0,
    },
  };
}

// ── The service ───────────────────────────────────────────────────────

export class LoggingService {
  private ctx: RequestContext;
  /** The tier that last answered successfully. Tried first on the next
   * call; the cascade still re-probes the earlier tiers ahead of it so a
   * recovered `:8090` is picked back up. */
  private preferredTier: Tier | null = null;

  constructor(ctx: RequestContext) {
    this.ctx = ctx;
  }

  /** Force-reset the resolved tier (e.g. for an explicit "retry direct"). */
  resetTier(): void {
    this.preferredTier = null;
  }

  /** The currently-resolved tier as a source label, or null if unprobed. */
  get resolvedSource(): LoggingSource | null {
    return this.preferredTier ? TIER_SOURCE[this.preferredTier] : null;
  }

  /** Tiers to try, preferred-first but always keeping the natural order so
   * a recovered higher tier is re-probed ahead of a lower fallback.
   *
   * Under relay only one tier exists: the radio lane carries `:8080/api/...`
   * and nothing else, so probing `direct` (`:8090`) and `proxy` would each
   * cost a full relay round trip before failing. */
  private tierSequence(): Tier[] {
    if (this.ctx.relay) return ["legacy"];
    if (!this.preferredTier || this.preferredTier === "direct") {
      return [...TIER_ORDER];
    }
    // Put the preferred tier first, then the rest in natural order minus it,
    // but still re-probe `direct` first so a recovered :8090 wins back.
    const rest = TIER_ORDER.filter((t) => t !== this.preferredTier);
    return ["direct", this.preferredTier, ...rest.filter((t) => t !== "direct")];
  }

  /** Issue one fetch against a tier and return the parsed JSON body, or
   * throw a TierUnavailable / TierHard error. Cloud (https) origins never
   * take the LAN path — they short-circuit as unavailable so the caller
   * degrades gracefully. */
  private async fetchTier(
    tier: Tier,
    path: string,
    query: string,
  ): Promise<unknown> {
    let origin: string;
    let prefix: string;
    try {
      ({ origin, prefix } = tierBase(this.ctx, tier));
    } catch {
      throw new TierUnavailableError(null, "unusable base url");
    }
    // Legacy only serves the logs path; map a generic `/query` onto it.
    const url =
      tier === "legacy"
        ? `${origin}${prefix}${query ? `?${query}` : ""}`
        : `${origin}${prefix}${path}${query ? `?${query}` : ""}`;

    const headers: Record<string, string> = {};
    if (this.ctx.apiKey) headers["X-ADOS-Key"] = this.ctx.apiKey;

    let res: Response;
    try {
      // A deadline is mandatory: a half-open socket would otherwise hang
      // this await forever, the catch would never run, and the tier
      // cascade would never advance past a silently-dead tier. An abort
      // surfaces here as a network-style error and cascades like any other.
      res = await timedFetch(url, { headers });
    } catch (err) {
      // Network error / DNS / mixed-content block / timeout — cascade.
      throw new TierUnavailableError(
        null,
        err instanceof Error ? err.message : "network error",
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (isHardError(res.status)) {
        throw new TierHardError(res.status, `${res.status}: ${detail}`);
      }
      if (CASCADE_STATUSES.has(res.status)) {
        throw new TierUnavailableError(res.status, `${res.status}: ${detail}`);
      }
      // Any other status (5xx etc.) is treated as a hard error for this call.
      throw new TierHardError(res.status, `${res.status}: ${detail}`);
    }
    return (await res.json()) as unknown;
  }

  /** Run `path` across the tier sequence, returning the first success +
   * the tier that produced it. */
  private async resolve(
    path: string,
    query: string,
  ): Promise<{ body: unknown; tier: Tier }> {
    let lastErr: Error | null = null;
    for (const tier of this.tierSequence()) {
      try {
        const body = await this.fetchTier(tier, path, query);
        this.preferredTier = tier;
        return { body, tier };
      } catch (err) {
        if (err instanceof TierHardError) {
          // Real error — do not mask it behind a fallback.
          throw new Error(err.message);
        }
        lastErr = err instanceof Error ? err : new Error(String(err));
        // TierUnavailable — keep cascading.
      }
    }
    throw new Error(
      `logd unavailable: ${lastErr ? lastErr.message : "no tier answered"}`,
    );
  }

  // ── query ────────────────────────────────────────────────────────────

  /** Keyset-paginated rows. Generic over the row type for the chosen
   * `kind` (defaults to logs). */
  async query<T = LoggingRow>(
    params: QueryParams = {},
  ): Promise<LoggingEnvelope<T>> {
    const query = buildQueryString(params);
    const { body, tier } = await this.resolve("/query", query);
    if (tier === "legacy") {
      // Legacy answers a flat array (or `{ entries: [...] }`); wrap it.
      const arr = Array.isArray(body)
        ? body
        : Array.isArray((body as { entries?: unknown[] })?.entries)
          ? (body as { entries: unknown[] }).entries
          : [];
      return wrapLegacy(arr) as unknown as LoggingEnvelope<T>;
    }
    return asEnvelope<T>(body, TIER_SOURCE[tier]);
  }

  /** Async iterator that walks every page of a query (newest first). Stops
   * when the server returns a null cursor. Caps total pages so a runaway
   * cursor can never spin forever. */
  async *queryAll<T = LoggingRow>(
    params: QueryParams = {},
    opts: { maxPages?: number } = {},
  ): AsyncGenerator<T, void, void> {
    const maxPages = opts.maxPages ?? 100;
    let cursor: string | undefined = params.cursor;
    let pages = 0;
    do {
      const page: LoggingEnvelope<T> = await this.query<T>({ ...params, cursor });
      for (const row of page.data) yield row;
      cursor = page.page.next_cursor ?? undefined;
      pages += 1;
      // Legacy answers one page with a null cursor, so this loop exits at once.
      if (page.data.length === 0) break;
    } while (cursor && pages < maxPages);
  }

  // ── tail (SSE) ─────────────────────────────────────────────────────────

  /** Open a live Server-Sent-Events stream. Returns the EventSource so the
   * caller wires up `message` / `error` handlers and closes it on unmount.
   * The key travels as a query param because `EventSource` cannot set a
   * request header in the browser. Tail is direct-only (the legacy
   * `/api/logs/stream` is not wired here — callers fall back to polling
   * when no tail source is available). Throws when no host is resolvable,
   * the runtime has no EventSource, or the agent is reached through a radio
   * relay (so the caller can fall back). */
  tail(params: TailParams = {}): EventSource {
    if (typeof EventSource === "undefined") {
      throw new Error("EventSource unavailable");
    }
    if (this.ctx.relay) {
      // The relay lane is a request/response RPC over the radio; it carries
      // no long-lived stream. Throwing here drops the caller to polling
      // instead of opening an EventSource against the ground station's own
      // logd, which would tail the WRONG node's logs.
      throw new Error("tail unavailable over a radio relay");
    }
    // Tail rides the direct tier when reachable, else the proxy bridge.
    const tier: Tier = this.preferredTier === "proxy" ? "proxy" : "direct";
    const { origin, prefix } = tierBase(this.ctx, tier);
    const qs = new URLSearchParams(buildQueryString(params));
    if (params.replay != null) qs.set("replay", String(params.replay));
    if (this.ctx.apiKey) qs.set("key", this.ctx.apiKey);
    const query = qs.toString();
    const url = `${origin}${prefix}/tail${query ? `?${query}` : ""}`;
    return new EventSource(url);
  }

  // ── aggregate ──────────────────────────────────────────────────────────

  /** Downsampled metric series for charts. */
  async aggregate(
    params: AggregateParams,
  ): Promise<LoggingEnvelope<AggregatePoint>> {
    const qs = new URLSearchParams();
    appendList(qs, "metric", params.metric);
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.session) qs.set("session", params.session);
    if (params.bucket) qs.set("bucket", params.bucket);
    if (params.agg) qs.set("agg", params.agg);
    appendList(qs, "group_by", params.group_by);
    // Aggregate is a logd/proxy capability; legacy has no equivalent, so a
    // legacy answer (flat array) yields an empty series rather than throwing.
    const { body, tier } = await this.resolve("/aggregate", qs.toString());
    if (tier === "legacy") {
      return {
        data: [],
        page: { next_cursor: null, count: 0 },
        meta: { source: "legacy", v: 1, ts: new Date().toISOString(), db_lag_ms: 0 },
      };
    }
    return asEnvelope<AggregatePoint>(body, TIER_SOURCE[tier]);
  }

  // ── sessions ───────────────────────────────────────────────────────────

  /** The boot / flight / manual session list. Legacy has no sessions, so
   * an old agent yields an empty list (the session picker then shows
   * "no sessions" rather than failing). */
  async sessions(
    params: SessionListParams = {},
  ): Promise<LoggingEnvelope<SessionRow>> {
    const qs = new URLSearchParams();
    if (params.from) qs.set("from", params.from);
    if (params.to) qs.set("to", params.to);
    if (params.kind) qs.set("kind", params.kind);
    if (params.open != null) qs.set("open", String(params.open));
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.cursor) qs.set("cursor", params.cursor);
    const { body, tier } = await this.resolve("/sessions", qs.toString());
    if (tier === "legacy") {
      return {
        data: [],
        page: { next_cursor: null, count: 0 },
        meta: { source: "legacy", v: 1, ts: new Date().toISOString(), db_lag_ms: 0 },
      };
    }
    return asEnvelope<SessionRow>(body, TIER_SOURCE[tier]);
  }

  // ── export ───────────────────────────────────────────────────────────

  /** Stream a bulk export. Returns the raw byte stream so the caller can
   * pipe it to a Blob/download without buffering the whole window. The
   * format defaults to `jsonl.zst`. Export is a logd/proxy capability;
   * throws on a pre-logd agent (the caller surfaces "export unavailable").
   */
  async export(params: ExportParams = {}): Promise<{
    stream: ReadableStream<Uint8Array>;
    format: ExportFormat;
    source: LoggingSource;
  }> {
    const format: ExportFormat = params.format ?? "jsonl.zst";
    const qs = new URLSearchParams(buildQueryString(params));
    qs.set("format", format);
    const query = qs.toString();

    // Export does not parse JSON, so it resolves the tier itself with a
    // streaming fetch. Cascade direct → proxy; legacy has no export, so a
    // relayed client (legacy-only) falls straight through to the honest
    // "no tier answered" error rather than streaming a bulk archive over
    // the radio.
    let lastErr: Error | null = null;
    for (const tier of this.tierSequence()) {
      if (tier === "legacy") continue;
      let origin: string;
      let prefix: string;
      try {
        ({ origin, prefix } = tierBase(this.ctx, tier));
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        continue;
      }
      const url = `${origin}${prefix}/export?${query}`;
      const headers: Record<string, string> = {};
      if (this.ctx.apiKey) headers["X-ADOS-Key"] = this.ctx.apiKey;
      try {
        // Bound the connection so a hung tier cascades to the next one. A
        // generous ceiling (vs the read default) leaves room for a real
        // bulk-window stream to drain — the deadline guards against a
        // silently-dead socket, not a slow-but-progressing download.
        const res = await timedFetch(url, { headers }, EXPORT_TIMEOUT_MS);
        if (!res.ok) {
          if (isHardError(res.status)) {
            throw new Error(`${res.status}`);
          }
          lastErr = new Error(`${res.status}`);
          continue;
        }
        if (!res.body) {
          lastErr = new Error("empty export body");
          continue;
        }
        this.preferredTier = tier;
        return { stream: res.body, format, source: TIER_SOURCE[tier] };
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw new Error(
      `export unavailable: ${lastErr ? lastErr.message : "no tier answered"}`,
    );
  }

  // ── push ───────────────────────────────────────────────────────────────

  /** Explicitly export a chosen window from the durable store to the paired
   * cloud account. Unlike the read surfaces, push is a WRITE and has exactly
   * ONE path: the agent's REST process at `:8080/api/logs/push`. There is no
   * tier cascade and the dedicated query port is never used, because the
   * agent process is the only thing that owns the writer-control socket that
   * flips a row as exported. The browser must never reach the query port for
   * a write. Cloud (https) origins short-circuit so a remote session degrades
   * to "push unavailable" rather than posting against the wrong host; a
   * relayed client posts through the relay-proxy prefix, which already lands
   * on the drone's own `:8080`, so it must not rebuild an origin. */
  async pushWindow(params: PushParams = {}): Promise<PushResult> {
    let origin: string;
    if (this.ctx.relay) {
      origin = this.ctx.baseUrl;
    } else {
      try {
        const u = new URL(this.ctx.baseUrl);
        if (u.protocol === "https:") throw new Error("cloud origin");
        origin = `${u.protocol}//${u.hostname}:${FASTAPI_PORT}`;
      } catch {
        throw new Error("push unavailable: unusable base url");
      }
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.ctx.apiKey) headers["X-ADOS-Key"] = this.ctx.apiKey;
    const body = JSON.stringify({
      from: params.from,
      to: params.to,
      kind: params.kind,
      source: params.source,
      level: params.level,
      text: params.text,
      session: params.session,
      format: params.format ?? "jsonl.zst",
    });
    const res = await timedFetch(
      `${origin}/api/logs/push`,
      { method: "POST", headers, body },
      EXPORT_TIMEOUT_MS,
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`push failed ${res.status}: ${detail}`);
    }
    const j = (await res.json()) as Record<string, unknown>;
    return {
      window_id: String(j.window_id ?? ""),
      sha256: String(j.sha256 ?? ""),
      bytes: Number(j.bytes ?? 0),
      rows: Number(j.rows ?? 0),
      deduped: Boolean(j.deduped),
      synced: Boolean(j.synced),
    };
  }

  // ── stats / healthz ────────────────────────────────────────────────────

  /** DB + ingest + sync health. Drives the health/sync badge. Legacy has
   * no stats; an old agent throws (the badge then renders "unknown"). */
  async stats(): Promise<StatsResponse> {
    const { body, tier } = await this.resolve("/stats", "");
    if (tier === "legacy") {
      throw new Error("stats unavailable on legacy agent");
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const db = (b.db ?? {}) as Record<string, unknown>;
    const ingest = (b.ingest ?? {}) as Record<string, unknown>;
    const sync = (b.sync ?? {}) as Record<string, unknown>;
    return {
      db: {
        file_size_mb: Number(db.file_size_mb ?? 0),
        wal_size_mb: Number(db.wal_size_mb ?? 0),
        row_counts:
          db.row_counts && typeof db.row_counts === "object"
            ? (db.row_counts as Record<string, number>)
            : {},
        integrity: typeof db.integrity === "boolean" ? db.integrity : undefined,
        user_version:
          typeof db.user_version === "number" ? db.user_version : undefined,
      },
      ingest: {
        rows_per_sec: Number(ingest.rows_per_sec ?? 0),
        drops:
          ingest.drops && typeof ingest.drops === "object"
            ? (ingest.drops as Record<string, number>)
            : {},
        queue_depth: Number(ingest.queue_depth ?? 0),
        last_batch_latency_ms:
          typeof ingest.last_batch_latency_ms === "number"
            ? ingest.last_batch_latency_ms
            : undefined,
      },
      sync: {
        pending_rows:
          sync.pending_rows && typeof sync.pending_rows === "object"
            ? (sync.pending_rows as Record<string, number>)
            : undefined,
        synced_rows: Number(sync.synced_rows ?? 0),
        last_push_time:
          typeof sync.last_push_time === "string" ? sync.last_push_time : null,
      },
      source: TIER_SOURCE[tier],
    };
  }

  /** Liveness/readiness probe. Returns `{ ok:false }` rather than throwing
   * when no tier answers, so a reachability check is a single await. */
  async healthz(): Promise<HealthzResponse> {
    try {
      const { body, tier } = await this.resolve("/healthz", "");
      if (tier === "legacy") {
        // A live legacy `/api/logs` answer means the agent is up, but there
        // is no durable store behind it.
        return {
          ok: true,
          db_open: false,
          writer_alive: false,
          integrity: false,
          source: "legacy",
        };
      }
      const b = (body ?? {}) as Record<string, unknown>;
      return {
        ok: b.ok === true,
        db_open: b.db_open === true,
        writer_alive: b.writer_alive === true,
        integrity: b.integrity === true,
        source: TIER_SOURCE[tier],
      };
    } catch {
      return {
        ok: false,
        db_open: false,
        writer_alive: false,
        integrity: false,
        source: "logd",
      };
    }
  }
}
