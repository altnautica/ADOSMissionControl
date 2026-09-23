/**
 * @module BlackBoxStore
 * @description Zustand store backing the ADOS Black Box view. Reads the
 * durable on-device store through the attached node's `client.logging`: the
 * session list, a keyset-paged filtered log table, time-aligned telemetry
 * aggregates, and the daemon health/sync badge. The view attaches the client
 * of the node it renders; attaching another client resets the store, and a
 * response that lands after its client was replaced is discarded, so one
 * node's review data never appears under another. All reads degrade
 * gracefully — an older agent (or cloud mode) leaves the store empty and the
 * view shows its empty state rather than throwing.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  AggregatePoint,
  HealthzResponse,
  LoggingRow,
  PushResult,
  SessionRow,
  StatsResponse,
} from "@/lib/agent/agent-client/logging";
import type { AgentClient } from "@/lib/agent/client";

/** Lifecycle of an explicit, operator-triggered cloud push. `pending` means
 * the agent accepted the request but the cloud export has not confirmed. */
export type PushState = "idle" | "pushing" | "pending" | "done" | "error";

/** Filters applied to the log table. `level` is a minimum level. */
export interface BlackBoxFilters {
  level?: string;
  text?: string;
  source?: string;
}

const LOG_PAGE_SIZE = 200;
/**
 * Ceiling on the accumulated log table.
 *
 * `fetchMore` used to append a page onto the previous array with no ceiling, so
 * an operator holding "load more" on a busy flight session grew one array
 * without limit and reallocated the whole thing on each page. 50 pages of
 * on-screen scrollback is far past what anyone reads before filtering; older
 * rows are dropped from the head and are still reachable by narrowing the
 * filters or the session, which re-queries the store.
 */
const MAX_ROWS = LOG_PAGE_SIZE * 50;
/** Metrics charted in the post-flight review pane. */
const HISTORY_METRICS = ["system.cpu_percent", "system.memory_percent"] as const;

interface BlackBoxState {
  /** The client of the node whose store this state describes, or null. */
  client: AgentClient | null;
  sessions: SessionRow[];
  selectedSessionId: string | null;
  rows: LoggingRow[];
  nextCursor: string | null;
  hasMore: boolean;
  filters: BlackBoxFilters;
  cpuHistory: AggregatePoint[];
  memoryHistory: AggregatePoint[];
  stats: StatsResponse | null;
  health: HealthzResponse | null;
  /** True when the resolved durable store reader answered at least once. */
  available: boolean;
  loadingSessions: boolean;
  loadingRows: boolean;
  loadingMore: boolean;
  exporting: boolean;
  lastUpdatedAt: number | null;
  /** State of an explicit cloud push. Local-first: nothing pushes unless the
   * operator triggers it; a never-pushed agent is correct, not broken. */
  pushState: PushState;
  lastPushResult: PushResult | null;
  pushError: string | null;
}

interface BlackBoxActions {
  setSelectedSession: (id: string | null) => void;
  setFilters: (filters: BlackBoxFilters) => void;
  fetchSessions: () => Promise<void>;
  fetchRows: () => Promise<void>;
  fetchMore: () => Promise<void>;
  fetchHistory: () => Promise<void>;
  fetchHealth: () => Promise<void>;
  /** Refresh everything for the current selection + filters. */
  refresh: () => Promise<void>;
  /** Trigger a streamed export download for the current selection. Returns
   * a filename + blob the caller hands to the browser, or null when the
   * surface is unavailable. */
  exportWindow: () => Promise<{ filename: string; blob: Blob } | null>;
  /** Explicitly push the current selection + filters to the paired cloud
   * account. Operator-only — never called from a filter / selection / refresh
   * path. Returns the ack on success, null on failure (with `pushError` set). */
  pushWindow: () => Promise<PushResult | null>;
  /** Point the store at a node's client. A different client resets every
   * field and loads the new node's store; the same client is a no-op. */
  attach: (client: AgentClient | null) => void;
  clear: () => void;
}

export type BlackBoxStore = BlackBoxState & BlackBoxActions;

const initialState: BlackBoxState = {
  client: null,
  sessions: [],
  selectedSessionId: null,
  rows: [],
  nextCursor: null,
  hasMore: false,
  filters: {},
  cpuHistory: [],
  memoryHistory: [],
  stats: null,
  health: null,
  available: false,
  loadingSessions: false,
  loadingRows: false,
  loadingMore: false,
  exporting: false,
  lastUpdatedAt: null,
  pushState: "idle",
  lastPushResult: null,
  pushError: null,
};

export const useBlackBoxStore = create<BlackBoxStore>((set, get) => ({
  ...initialState,

  setSelectedSession(id) {
    set({ selectedSessionId: id });
    void get().fetchRows();
    void get().fetchHistory();
  },

  setFilters(filters) {
    set({ filters });
    void get().fetchRows();
  },

  async fetchSessions() {
    const { client } = get();
    if (!client?.logging) return;
    set({ loadingSessions: true });
    try {
      const envelope = await client.logging.sessions({ limit: 50 });
      if (get().client !== client) return;
      set({
        sessions: envelope.data,
        available: true,
        loadingSessions: false,
        lastUpdatedAt: Date.now(),
      });
    } catch {
      if (get().client === client) set({ loadingSessions: false });
    }
  },

  async fetchRows() {
    const { client, selectedSessionId, filters } = get();
    if (!client?.logging) return;
    set({ loadingRows: true });
    try {
      const envelope = await client.logging.query({
        session: selectedSessionId ?? undefined,
        level: filters.level,
        text: filters.text,
        source: filters.source ? [filters.source] : undefined,
        limit: LOG_PAGE_SIZE,
      });
      if (get().client !== client) return;
      set({
        rows: envelope.data,
        nextCursor: envelope.page.next_cursor,
        hasMore: envelope.page.next_cursor !== null,
        available: true,
        loadingRows: false,
        lastUpdatedAt: Date.now(),
      });
    } catch {
      if (get().client === client) set({ loadingRows: false });
    }
  },

  async fetchMore() {
    const { client, selectedSessionId, filters, nextCursor, loadingMore } = get();
    if (!client?.logging) return;
    if (!nextCursor || loadingMore) return;
    set({ loadingMore: true });
    try {
      const envelope = await client.logging.query({
        session: selectedSessionId ?? undefined,
        level: filters.level,
        text: filters.text,
        source: filters.source ? [filters.source] : undefined,
        limit: LOG_PAGE_SIZE,
        cursor: nextCursor,
      });
      if (get().client !== client) return;
      set((s) => {
        const merged = [...s.rows, ...envelope.data];
        return {
          // Drop from the head once past the ceiling: the newest page is the
          // one the operator just asked for.
          rows:
            merged.length > MAX_ROWS
              ? merged.slice(merged.length - MAX_ROWS)
              : merged,
          nextCursor: envelope.page.next_cursor,
          hasMore: envelope.page.next_cursor !== null,
          loadingMore: false,
        };
      });
    } catch {
      if (get().client === client) set({ loadingMore: false });
    }
  },

  async fetchHistory() {
    const { client, selectedSessionId } = get();
    if (!client?.logging) return;
    try {
      const envelope = await client.logging.aggregate({
        metric: [...HISTORY_METRICS],
        session: selectedSessionId ?? undefined,
        from: selectedSessionId ? undefined : "-1h",
        bucket: "auto",
        agg: "avg",
      });
      if (get().client !== client) return;
      const cpu = envelope.data.filter((p) => p.metric === "system.cpu_percent");
      const mem = envelope.data.filter(
        (p) => p.metric === "system.memory_percent",
      );
      set({ cpuHistory: cpu, memoryHistory: mem });
    } catch {
      /* charts stay empty on an agent without aggregate */
    }
  },

  async fetchHealth() {
    const { client } = get();
    if (!client?.logging) return;
    try {
      const [health, stats] = await Promise.all([
        client.logging.healthz(),
        client.logging.stats().catch(() => null),
      ]);
      if (get().client !== client) return;
      set({ health, stats });
    } catch {
      /* badge stays unknown */
    }
  },

  async refresh() {
    await Promise.all([
      get().fetchSessions(),
      get().fetchRows(),
      get().fetchHistory(),
      get().fetchHealth(),
    ]);
  },

  async exportWindow() {
    const { client, selectedSessionId, filters } = get();
    if (!client?.logging) return null;
    set({ exporting: true });
    try {
      const { stream, format } = await client.logging.export({
        session: selectedSessionId ?? undefined,
        level: filters.level,
        text: filters.text,
        source: filters.source ? [filters.source] : undefined,
        format: "jsonl.zst",
      });
      const blob = await new Response(stream).blob();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const label = selectedSessionId ? `-${selectedSessionId}` : "";
      const ext = format === "jsonl.zst" ? "jsonl.zst" : "jsonl";
      if (get().client === client) set({ exporting: false });
      return { filename: `ados-blackbox${label}-${stamp}.${ext}`, blob };
    } catch {
      if (get().client === client) set({ exporting: false });
      return null;
    }
  },

  async pushWindow() {
    const { client, selectedSessionId } = get();
    if (!client?.logging) {
      set({ pushState: "error", pushError: "push_unavailable" });
      return null;
    }
    set({ pushState: "pushing", pushError: null });
    try {
      // The push route scopes by session only; the table's level, text and
      // source filters have no push equivalent.
      const result = await client.logging.pushWindow({
        session: selectedSessionId ?? undefined,
      });
      if (get().client === client) {
        set({
          pushState: result.pending ? "pending" : "done",
          lastPushResult: result,
          pushError: null,
        });
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (get().client === client) set({ pushState: "error", pushError: message });
      return null;
    }
  },

  attach(client) {
    if (get().client === client) return;
    set({ ...initialState, client });
    if (client) void get().refresh();
  },

  clear() {
    set({ ...initialState });
  },
}));
