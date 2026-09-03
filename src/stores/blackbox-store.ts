/**
 * @module BlackBoxStore
 * @description Zustand store backing the ADOS Black Box view. Reads the
 * durable on-device store through `client.logging`: the session list, a
 * keyset-paged filtered log table, time-aligned telemetry aggregates, and
 * the daemon health/sync badge. All reads degrade gracefully — an older
 * agent (or cloud mode) leaves the store empty and the view shows its
 * empty state rather than throwing.
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
import { useAgentConnectionStore } from "./agent-connection-store";

/** Lifecycle of an explicit, operator-triggered cloud push. */
export type PushState = "idle" | "pushing" | "done" | "error";

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
  clear: () => void;
}

export type BlackBoxStore = BlackBoxState & BlackBoxActions;

const initialState: BlackBoxState = {
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
    const { client } = useAgentConnectionStore.getState();
    if (!client?.logging) return;
    set({ loadingSessions: true });
    try {
      const envelope = await client.logging.sessions({ limit: 50 });
      set({
        sessions: envelope.data,
        available: true,
        loadingSessions: false,
        lastUpdatedAt: Date.now(),
      });
    } catch {
      set({ loadingSessions: false });
    }
  },

  async fetchRows() {
    const { client } = useAgentConnectionStore.getState();
    if (!client?.logging) return;
    const { selectedSessionId, filters } = get();
    set({ loadingRows: true });
    try {
      const envelope = await client.logging.query({
        session: selectedSessionId ?? undefined,
        level: filters.level,
        text: filters.text,
        source: filters.source ? [filters.source] : undefined,
        limit: LOG_PAGE_SIZE,
      });
      set({
        rows: envelope.data,
        nextCursor: envelope.page.next_cursor,
        hasMore: envelope.page.next_cursor !== null,
        available: true,
        loadingRows: false,
        lastUpdatedAt: Date.now(),
      });
    } catch {
      set({ loadingRows: false });
    }
  },

  async fetchMore() {
    const { client } = useAgentConnectionStore.getState();
    if (!client?.logging) return;
    const { selectedSessionId, filters, nextCursor, loadingMore } = get();
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
      set({ loadingMore: false });
    }
  },

  async fetchHistory() {
    const { client } = useAgentConnectionStore.getState();
    if (!client?.logging) return;
    const { selectedSessionId } = get();
    try {
      const envelope = await client.logging.aggregate({
        metric: [...HISTORY_METRICS],
        session: selectedSessionId ?? undefined,
        from: selectedSessionId ? undefined : "-1h",
        bucket: "auto",
        agg: "avg",
      });
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
    const { client } = useAgentConnectionStore.getState();
    if (!client?.logging) return;
    try {
      const [health, stats] = await Promise.all([
        client.logging.healthz(),
        client.logging.stats().catch(() => null),
      ]);
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
    const { client } = useAgentConnectionStore.getState();
    if (!client?.logging) return null;
    const { selectedSessionId, filters } = get();
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
      set({ exporting: false });
      return { filename: `ados-blackbox${label}-${stamp}.${ext}`, blob };
    } catch {
      set({ exporting: false });
      return null;
    }
  },

  async pushWindow() {
    const { client } = useAgentConnectionStore.getState();
    if (!client?.logging) {
      set({ pushState: "error", pushError: "push_unavailable" });
      return null;
    }
    const { selectedSessionId, filters } = get();
    set({ pushState: "pushing", pushError: null });
    try {
      const result = await client.logging.pushWindow({
        session: selectedSessionId ?? undefined,
        level: filters.level,
        text: filters.text,
        source: filters.source ? [filters.source] : undefined,
        format: "jsonl.zst",
      });
      set({ pushState: "done", lastPushResult: result, pushError: null });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ pushState: "error", pushError: message });
      return null;
    }
  },

  clear() {
    set({ ...initialState });
  },
}));
