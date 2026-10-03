/**
 * @module agent/agent-client/logging
 * @description The `LoggingService` domain module. Reads the durable
 * on-device log/telemetry/event/hardware store and surfaces it through a
 * single typed client. Transport resolution is local-first and two-tier:
 *
 *   1. proxy        <agent>/api/v2/observability/v1/...  (primary)
 *   2. legacy       <agent>/api/logs                     (store off / older agents)
 *
 * `<agent>` is `http://<host>:8080` on the LAN, or the ground station's
 * relay-proxy prefix for a relayed drone: both tiers live on the agent's
 * `:8080` front, which is exactly what the relay forwards to.
 *
 * The store's own query port is not a tier: it serves no CORS headers, so a
 * browser (and the desktop app, which keeps web security on) can never read
 * its answers. Every call tries the tiers in natural order and only cascades
 * on a service-unavailable signal (404 / 502 / 503 / network error).
 * Bad-request / auth / rate-limit responses (400 / 401 / 403 / 429) do NOT
 * cascade — they are surfaced as the real error.
 *
 * The relay carries unary request/response only, so over it the live tail
 * is a 2 s poll of the same query and an export pages through the query.
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
import {
  normaliseBucket,
  normaliseHealth,
  normaliseQueryRow,
  normaliseSessionRow,
  normaliseStats,
  toLogLevel,
  usToIso,
} from "./logging-wire";
import { openLogTail, type LogTail, type LogTailHandlers } from "./log-tail";

export type { LogTail, LogTailHandlers } from "./log-tail";

// ── Row shapes ────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warning" | "error";

/** A single log row from the durable store (`kind=logs`), normalised from the
 * store's `LogRow` wire shape by `logging-wire.ts`. */
export interface LoggingRow {
  /** ISO-8601 timestamp derived from `ts_us`. */
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

/** A discrete event row (`kind=events`). `data` is the store's `detail` map. */
export interface EventsRow {
  ts: string;
  ts_us: number;
  kind: string;
  data?: Record<string, unknown>;
  /** Emitting component. */
  source?: string;
  severity?: LogLevel;
}

/** A hardware snapshot row (`kind=hw`): the store's open signal map. */
export interface HWRow {
  ts: string;
  ts_us: number;
  signals: Record<string, unknown>;
}

/** A boot / flight / manual session. */
export interface SessionRow {
  id: string;
  /** ISO-8601, derived from the store's `started_us`. */
  started: string;
  /** ISO-8601, or null while the session is still open. */
  ended: string | null;
  kind: "boot" | "flight" | "manual";
  reason?: string;
  meta?: Record<string, unknown>;
  log_count: number;
  event_count: number;
  /** The store's `span_us` in milliseconds; null while the session is open. */
  duration_ms: number | null;
}

/** One bucketed aggregate point. `ts_us` is the bucket start. */
export interface AggregatePoint {
  ts: string;
  ts_us: number;
  metric: string;
  value: number;
  /** Samples folded into the bucket. */
  count?: number;
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

/** Selector for an explicit, operator-triggered cloud export. These are the
 * only fields the agent's push route reads: an empty selector exports every
 * unsynced row of all four kinds. */
export interface PushParams {
  /** Restrict to one store session id (an integer on the wire). */
  session?: string;
  /** Lower time bound: ISO-8601, epoch microseconds, or relative (`-2h`). */
  since?: string;
  /** Tables to export; absent means all four. */
  kinds?: LoggingKind[];
}

/** The agent's answer for one push request. */
export interface PushResult {
  /** The cloud service had not answered inside the agent's poll window. The
   * request is on disk and may still complete; nothing is confirmed yet. */
  pending: boolean;
  /** Cloud record id for the stored window; null while pending. */
  window_id: string | null;
  /** Server-recomputed sha256 of the uploaded bytes, hex; null while pending. */
  sha256: string | null;
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

/** Store + ingest + sync health, as the store's `/v1/stats` reports it. */
export interface StatsResponse {
  db: {
    size_bytes: number;
    wal_size_bytes: number;
    row_counts: Record<string, number>;
    /** True only when the integrity check read `ok`. */
    integrity: boolean;
    /** The raw integrity result (`ok`, or the failure text). */
    integrity_detail: string;
    schema_version: number | null;
  };
  ingest: {
    /** Frames accepted since the store daemon started. */
    accepted: number;
    /** Frames dropped under backpressure, per class. */
    dropped: Record<string, number>;
  };
  sync: {
    /** Rows not yet pushed to the cloud, per table. */
    unsynced_rows: Record<string, number>;
  };
  oldest_ts_us: number | null;
  newest_ts_us: number | null;
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

/** The agent REST port; the proxy bridge and the legacy route both live here. */
const FASTAPI_PORT = 8080;
const PROXY_PREFIX = "/api/v2/observability";

/** Cadence of the relayed live tail's query poll. */
const RELAY_TAIL_POLL_MS = 2000;
/** Rows per relayed tail poll page and per relayed export page. A relayed
 * response body is capped near 69 KB, and a stored log row with its fields
 * runs a few hundred bytes, so a page this size leaves headroom. */
const RELAY_PAGE_ROWS = 100;
/** Pages one relayed tail poll may walk. A burst beyond this many rows in
 * one poll interval skips ahead to the newest rather than lagging behind. */
const RELAY_TAIL_MAX_PAGES = 10;

/** Longest the streaming export may wait for its next bytes (headers first,
 * then each chunk). An inactivity bound, not a total one: a large window
 * that keeps arriving is never cut off, while a silently-dead socket is. */
const EXPORT_IDLE_TIMEOUT_MS = AGENT_FETCH_TIMEOUT_MS * 10;

/** The push write waits for the agent's own result poll (up to ~8 s) before
 * it answers, so its deadline sits well above the read default. */
const PUSH_TIMEOUT_MS = AGENT_FETCH_TIMEOUT_MS * 10;

type Tier = "proxy" | "legacy";

const TIER_ORDER: readonly Tier[] = ["proxy", "legacy"];

const TIER_SOURCE: Record<Tier, LoggingSource> = {
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
 * station's relay-proxy prefix, which already lands on the drone's own
 * `:8080`. Rebuilding an origin here would discard the prefix and dial the
 * GROUND STATION's own REST port, returning the ground station's own logs
 * labelled as the drone's. So the relay keeps the prefix verbatim and
 * appends the tier path — no `new URL()`, no port surgery. */
function tierBase(
  ctx: RequestContext,
  tier: Tier,
): { origin: string; prefix: string } {
  const prefix = tier === "proxy" ? `${PROXY_PREFIX}/v1` : "/api/logs";
  if (ctx.relay) {
    return { origin: ctx.baseUrl, prefix };
  }
  const u = new URL(ctx.baseUrl);
  // http: on LAN; https: cloud origins won't take this path
  return { origin: `${u.protocol}//${u.hostname}:${FASTAPI_PORT}`, prefix };
}

/** Wrap an export body so a read that waits longer than `idleMs` for the
 * next chunk aborts the request. The timer runs only while a read is
 * outstanding, so a consumer that pauses is never mistaken for a stall. */
function withIdleDeadline(
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
  idleMs: number,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(out) {
      const timer = setTimeout(
        () => controller.abort(new DOMException("export stalled", "TimeoutError")),
        idleMs,
      );
      try {
        const { done, value } = await reader.read();
        if (done) out.close();
        else out.enqueue(value);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

/** The push route takes an integer session id; anything else would be
 * refused with a 400, so it is refused here with the reason. */
function pushSessionId(session: string | undefined): number | undefined {
  if (session === undefined) return undefined;
  const n = Number(session);
  if (!Number.isInteger(n)) {
    throw new Error(`push failed: session ${session} is not a store session id`);
  }
  return n;
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
  const level = toLogLevel(r.level);
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

/** The empty result a read surface returns when the tier that answered (the
 * legacy `/api/logs` shape) cannot carry it at all. Several surfaces must
 * agree on this shape, so it is built in one place. */
function emptyLegacyEnvelope<T>(): LoggingEnvelope<T> {
  return {
    data: [],
    page: { next_cursor: null, count: 0 },
    meta: {
      source: "legacy",
      v: 1,
      ts: new Date().toISOString(),
      db_lag_ms: 0,
    },
  };
}

/** Coerce a raw `/v1` JSON body into the typed envelope, mapping each wire
 * row through `mapRow` and tolerating extra fields the agent ships ahead of
 * the client. */
function asEnvelope<T>(
  body: unknown,
  source: LoggingSource,
  mapRow: (raw: unknown, idx: number) => T,
): LoggingEnvelope<T> {
  const b = (body ?? {}) as Record<string, unknown>;
  const data = Array.isArray(b.data) ? b.data.map(mapRow) : [];
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
      // The store stamps the server time as a microsecond epoch.
      ts:
        typeof meta.ts === "number"
          ? usToIso(meta.ts)
          : typeof meta.ts === "string"
            ? meta.ts
            : new Date().toISOString(),
      db_lag_ms: typeof meta.db_lag_ms === "number" ? meta.db_lag_ms : 0,
    },
  };
}

// ── The service ───────────────────────────────────────────────────────

export class LoggingService {
  private ctx: RequestContext;

  constructor(ctx: RequestContext) {
    this.ctx = ctx;
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
      // The relay client carries a longer default deadline than a LAN read
      // (`ctx.defaultTimeoutMs`); without threading it, every relay logging
      // read aborts at 6 s under a 10 s ground bound. `undefined` on the LAN
      // client falls back to `AGENT_FETCH_TIMEOUT_MS` inside `timedFetch`.
      res = await timedFetch(url, { headers }, this.ctx.defaultTimeoutMs);
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

  /** Run `path` across the tiers, returning the first success + the tier
   * that produced it. Every call tries the tiers in natural order: the
   * legacy route answers any path, so letting a tier that answered last time
   * jump the queue would stop the proxy from ever being retried after one
   * outage. */
  private async resolve(
    path: string,
    query: string,
  ): Promise<{ body: unknown; tier: Tier }> {
    let lastErr: Error | null = null;
    for (const tier of TIER_ORDER) {
      try {
        const body = await this.fetchTier(tier, path, query);
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
    const kind = params.kind ?? "logs";
    return asEnvelope<T>(
      body,
      TIER_SOURCE[tier],
      (raw, idx) => normaliseQueryRow(kind, raw, idx) as T,
    );
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

  // ── tail ─────────────────────────────────────────────────────────────

  /** Open a live log tail (`kind=logs`). Each row reaches `handlers.onRow`
   * already normalised, and a dropped or refused tail reaches
   * `handlers.onError` once.
   *
   * On the LAN the tail is the store's SSE stream, read with `fetch` so the
   * key travels in the `X-ADOS-Key` header, never in the URL. The relay
   * carries unary request/response only, so a relayed tail polls the query
   * surface instead (see {@link pollTail}). Throws when no host is
   * resolvable (so the caller can fall back). */
  tail(params: TailParams, handlers: LogTailHandlers): LogTail {
    if (this.ctx.relay) return this.pollTail(params, handlers);
    const { origin, prefix } = tierBase(this.ctx, "proxy");
    const qs = new URLSearchParams(buildQueryString({ ...params, kind: "logs" }));
    if (params.replay != null) qs.set("replay", String(params.replay));
    const url = `${origin}${prefix}/tail?${qs.toString()}`;
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (this.ctx.apiKey) headers["X-ADOS-Key"] = this.ctx.apiKey;
    return openLogTail(
      url,
      headers,
      this.ctx.defaultTimeoutMs ?? AGENT_FETCH_TIMEOUT_MS,
      handlers,
    );
  }

  /**
   * The relayed live tail: poll the query every {@link RELAY_TAIL_POLL_MS}
   * with a time cursor (the newest delivered `ts_us`, inclusive on the
   * store, plus the rows already delivered at exactly that stamp so none
   * repeats). The first poll delivers the newest `replay` rows; each later
   * poll pages back from the newest row to the cursor and delivers what is
   * new, oldest first. Polls never overlap. A failed poll ends the tail
   * through `onError`, like a dropped stream.
   */
  private pollTail(params: TailParams, handlers: LogTailHandlers): LogTail {
    const replay = params.replay ?? 0;
    // The tail owns the time bound and the paging cursor.
    const filters: QueryParams = { ...params, from: undefined, cursor: undefined };
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sinceUs: number | null = null;
    let deliveredAtSince = new Set<string>();
    const rowKey = (row: LoggingRow) => `${row.ts_us}\u0000${row.source}\u0000${row.message}`;
    // The store pages newest first; the legacy route's order is not part of
    // its contract, so every page is put newest first here.
    const newestFirst = (rows: LoggingRow[]) => [...rows].sort((a, b) => b.ts_us - a.ts_us);

    const pollOnce = async (): Promise<LoggingRow[]> => {
      if (sinceUs === null) {
        // First poll: establish the cursor at the newest row and replay.
        const page = await this.query<LoggingRow>({
          ...filters,
          kind: "logs",
          limit: Math.min(Math.max(replay, 1), RELAY_PAGE_ROWS),
        });
        const rows = newestFirst(page.data);
        const newestUs = rows.length > 0 ? rows[0].ts_us : 0;
        sinceUs = newestUs;
        deliveredAtSince = new Set(rows.filter((r) => r.ts_us === newestUs).map(rowKey));
        return rows.slice(0, replay);
      }
      const since = sinceUs;
      const fresh: LoggingRow[] = [];
      let cursor: string | undefined;
      for (let pages = 0; pages < RELAY_TAIL_MAX_PAGES && !closed; pages += 1) {
        const page = await this.query<LoggingRow>({
          ...filters,
          kind: "logs",
          from: String(since),
          limit: RELAY_PAGE_ROWS,
          cursor,
        });
        // Rows come newest first; the legacy tier ignores `from`, so the
        // bound is enforced here as well.
        let reachedCursor = false;
        for (const row of newestFirst(page.data)) {
          if (row.ts_us < since) {
            reachedCursor = true;
            break;
          }
          if (row.ts_us === since && deliveredAtSince.has(rowKey(row))) continue;
          fresh.push(row);
        }
        cursor = page.page.next_cursor ?? undefined;
        if (reachedCursor || !cursor || page.data.length === 0) break;
      }
      if (fresh.length > 0) {
        const newestUs = fresh[0].ts_us;
        const atNewest = fresh.filter((r) => r.ts_us === newestUs).map(rowKey);
        if (newestUs === since) {
          for (const key of atNewest) deliveredAtSince.add(key);
        } else {
          sinceUs = newestUs;
          deliveredAtSince = new Set(atNewest);
        }
      }
      return fresh;
    };

    const tick = async () => {
      let rows: LoggingRow[];
      try {
        rows = await pollOnce();
      } catch (err) {
        if (!closed) {
          closed = true;
          handlers.onError(err instanceof Error ? err : new Error(String(err)));
        }
        return;
      }
      if (closed) return;
      // Oldest first, the order a stream would have delivered them in.
      for (let i = rows.length - 1; i >= 0; i -= 1) handlers.onRow(rows[i]);
      timer = setTimeout(() => void tick(), RELAY_TAIL_POLL_MS);
    };
    void tick();

    return {
      close: () => {
        closed = true;
        clearTimeout(timer);
      },
    };
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
    // Legacy has no equivalent, so a legacy answer (flat array) yields an
    // empty series rather than throwing.
    const { body, tier } = await this.resolve("/aggregate", qs.toString());
    if (tier === "legacy") {
      return emptyLegacyEnvelope<AggregatePoint>();
    }
    return asEnvelope(body, TIER_SOURCE[tier], normaliseBucket);
  }

  // ── sessions ───────────────────────────────────────────────────────────

  /** The boot / flight / manual session list. Legacy has no sessions, so
   * a store-less agent yields an empty list (the session picker then shows
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
      return emptyLegacyEnvelope<SessionRow>();
    }
    return asEnvelope(body, TIER_SOURCE[tier], normaliseSessionRow);
  }

  // ── export ───────────────────────────────────────────────────────────

  /** Stream a bulk export. Returns the raw byte stream so the caller can
   * pipe it to a Blob/download without buffering the whole window. The
   * format defaults to `jsonl.zst`. Export is a store capability served by
   * the proxy bridge (legacy has no export endpoint); throws on a store-less
   * agent (the caller surfaces "export unavailable") and throws the refusal
   * on an auth or request error. Over a relay, which carries unary
   * request/response only, the window is paged through the query instead
   * (see {@link pagedExport}) and always arrives as plain `jsonl`.
   */
  async export(params: ExportParams = {}): Promise<{
    stream: ReadableStream<Uint8Array>;
    format: ExportFormat;
    source: LoggingSource;
  }> {
    if (this.ctx.relay) return this.pagedExport(params);
    const format: ExportFormat = params.format ?? "jsonl.zst";
    const qs = new URLSearchParams(buildQueryString(params));
    qs.set("format", format);
    const query = qs.toString();

    let origin: string;
    let prefix: string;
    try {
      ({ origin, prefix } = tierBase(this.ctx, "proxy"));
    } catch {
      throw new Error("export unavailable: unusable base url");
    }
    const headers: Record<string, string> = {};
    if (this.ctx.apiKey) headers["X-ADOS-Key"] = this.ctx.apiKey;

    // An inactivity deadline, not a total one: it covers the wait for the
    // response headers here and then every chunk wait inside the returned
    // stream, so a dead socket aborts while a long, still-arriving window
    // is never cut off.
    const controller = new AbortController();
    const connectTimer = setTimeout(
      () => controller.abort(new DOMException("export stalled", "TimeoutError")),
      EXPORT_IDLE_TIMEOUT_MS,
    );
    let res: Response;
    try {
      res = await fetch(`${origin}${prefix}/export?${query}`, {
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        `export unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(connectTimer);
    }
    if (!res.ok) {
      if (isHardError(res.status)) {
        throw new Error(`export refused: ${res.status}`);
      }
      throw new Error(`export unavailable: ${res.status}`);
    }
    if (!res.body) {
      throw new Error("export unavailable: empty export body");
    }
    return {
      stream: withIdleDeadline(res.body, controller, EXPORT_IDLE_TIMEOUT_MS),
      format,
      source: TIER_SOURCE.proxy,
    };
  }

  /**
   * The relayed export: walk the store's query with its keyset cursor, one
   * {@link RELAY_PAGE_ROWS}-row page per relay round trip, and emit each
   * wire row as one JSONL line (the same rows, filters and line format the
   * store's own export writes). The first page is read before returning so
   * a refusal or a store that is not serving throws like the LAN export;
   * later pages are read as the consumer pulls. Only the proxy tier is
   * asked, because the legacy route has no export.
   */
  private async pagedExport(params: ExportParams): Promise<{
    stream: ReadableStream<Uint8Array>;
    format: ExportFormat;
    source: LoggingSource;
  }> {
    const readPage = async (
      cursor: string | undefined,
    ): Promise<{ rows: unknown[]; next: string | null }> => {
      // `format` is not a query parameter; the window's filters are.
      const query = buildQueryString({ ...params, limit: RELAY_PAGE_ROWS, cursor });
      let body: unknown;
      try {
        body = await this.fetchTier("proxy", "/query", query);
      } catch (err) {
        if (err instanceof TierHardError) throw new Error(`export refused: ${err.status}`);
        throw new Error(
          `export unavailable: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const env = asEnvelope(body, TIER_SOURCE.proxy, (raw) => raw);
      return { rows: env.data, next: env.page.next_cursor };
    };

    const encoder = new TextEncoder();
    let page = await readPage(params.cursor);
    let done = false;
    const seenCursors = new Set<string>();
    const stream = new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (done) {
          controller.close();
          return;
        }
        if (page.rows.length > 0) {
          controller.enqueue(
            encoder.encode(page.rows.map((row) => `${JSON.stringify(row)}\n`).join("")),
          );
        }
        // A repeated cursor would loop forever; treat it as the end.
        const next = page.next;
        if (next === null || page.rows.length === 0 || seenCursors.has(next)) {
          done = true;
          return;
        }
        seenCursors.add(next);
        page = await readPage(next);
      },
    });
    return { stream, format: "jsonl", source: TIER_SOURCE.proxy };
  }

  // ── push ───────────────────────────────────────────────────────────────

  /** Explicitly export a chosen window from the durable store to the paired
   * cloud account. Unlike the read surfaces, push is a WRITE and has exactly
   * ONE path: the agent's REST process at `:8080/api/logs/push`. There is no
   * tier cascade, because the agent process is the only thing that owns the
   * writer-control socket that flips a row as exported. Cloud (https) origins
   * short-circuit so a remote session degrades to "push unavailable" rather
   * than posting against the wrong host; a relayed client posts through the
   * relay-proxy prefix, which already lands on the drone's own `:8080`, so it
   * must not rebuild an origin.
   *
   * Resolves with `pending: true` when the agent accepted the request but the
   * cloud service had not answered yet. Throws when the service answered
   * with an error or without exporting the window. */
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
      session: pushSessionId(params.session),
      since: params.since,
      kinds: params.kinds,
    });
    const res = await timedFetch(
      `${origin}/api/logs/push`,
      { method: "POST", headers, body },
      PUSH_TIMEOUT_MS,
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`push failed ${res.status}: ${detail}`);
    }
    const j = (await res.json()) as Record<string, unknown>;
    if (typeof j.error === "string" && j.error) {
      throw new Error(`push failed: ${j.error}`);
    }
    const pending = j.pending === true;
    if (!pending && j.pushed !== true) {
      throw new Error("push failed: the window was not exported");
    }
    return {
      pending,
      window_id: j.window_id == null ? null : String(j.window_id),
      sha256: typeof j.sha256 === "string" ? j.sha256 : null,
      bytes: Number(j.bytes ?? 0),
      rows: Number(j.rows ?? 0),
      deduped: j.deduped === true,
      synced: j.synced === true,
    };
  }

  // ── stats / healthz ────────────────────────────────────────────────────

  /** DB + ingest + sync health. Drives the health/sync badge. Legacy has
   * no stats; a store-less agent throws (the badge then renders "unknown"). */
  async stats(): Promise<StatsResponse> {
    const { body, tier } = await this.resolve("/stats", "");
    if (tier === "legacy") {
      throw new Error("stats unavailable on legacy agent");
    }
    return { ...normaliseStats(body), source: TIER_SOURCE[tier] };
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
      return { ...normaliseHealth(body), source: TIER_SOURCE[tier] };
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
