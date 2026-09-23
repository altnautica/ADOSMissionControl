"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, EyeOff, Eye, Radio, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { hasClientPath } from "@/lib/agent/config-access";
import type { LogEntry } from "@/lib/agent/types";
import type { LogTail, LoggingRow } from "@/lib/agent/agent-client/logging";
import { getFreshness, useClockTick } from "@/lib/agent/freshness";
import { useClockStore } from "@/stores/clock-store";

interface LogViewerProps {
  logs: LogEntry[];
  onRefresh: (level?: string) => void;
}

const levelColors: Record<LogEntry["level"], string> = {
  debug: "text-text-tertiary",
  info: "text-accent-primary",
  warning: "text-status-warning",
  error: "text-status-error",
};

const levelFilterKeys = [
  { key: "allLogs", value: undefined },
  { key: "infoLogs", value: "info" },
  { key: "warningLogs", value: "warning" },
  { key: "errorLogs", value: "error" },
] as const;

// Noisy info-level events that get auto-suppressed by
// default. The user can toggle the "Show noise" eye icon to see them.
// Each entry: [service-prefix, message-prefix]. Match is `service.startsWith(s) && message.startsWith(m)`.
const NOISY_PATTERNS: ReadonlyArray<readonly [string, string]> = [
  ["hal.usb", "usb_scan_complete"],
  ["hal.hotplug", "usb_device_added"],
  ["hal.hotplug", "usb_device_removed"],
  ["ados.core.supervisor", "hotplug_event_pre_gate"],
  ["ados.core.supervisor", "hotplug_event_debounced"],
  ["mavlink.streams", "stream_request"],
];

const MAX_LIVE_LINES = 500;
const OLDER_PAGE_SIZE = 200;
/** Fixed delay before re-attaching a dropped live tail; retried forever. */
const TAIL_RETRY_MS = 3000;
/** Cadence of the prop-feed refresh while no live tail is attached. */
const LOG_POLL_MS = 5000;

// Render a log entry's timestamp as HH:MM:SS in the browser's local time
// zone, whichever form it arrives in: an ISO-8601 string with an offset (the
// durable store) or a raw epoch number (older agents). Both paths go through
// Date so an agent-offset string and an epoch for the same instant read the
// same wall time. Returns "" for anything unparseable so a malformed entry
// never throws.
export function formatLogTime(ts: unknown): string {
  let ms: number;
  if (typeof ts === "string") {
    const asNum = Number(ts);
    if (ts.trim() !== "" && Number.isFinite(asNum)) return formatLogTime(asNum);
    ms = Date.parse(ts);
  } else if (typeof ts === "number" && Number.isFinite(ts)) {
    // Heuristic: values below 1e12 are epoch seconds, not milliseconds.
    ms = ts < 1e12 ? ts * 1000 : ts;
  } else {
    return "";
  }
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toTimeString().slice(0, 8);
}

function isNoisyEntry(entry: LogEntry): boolean {
  if (entry.level !== "info" && entry.level !== "debug") return false;
  return NOISY_PATTERNS.some(
    ([service, message]) =>
      entry.service?.startsWith(service) && entry.message?.startsWith(message)
  );
}

/** Map a durable-store row onto the LogEntry shape the viewer renders. */
function rowToEntry(row: LoggingRow): LogEntry {
  return {
    timestamp: row.ts,
    level: row.level,
    service: row.source,
    message: row.message,
  };
}

export function LogViewer({ logs, onRefresh }: LogViewerProps) {
  const t = useTranslations("agent");
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const client = useAgentConnectionStore((s) => s.client);

  const levelFilters = useMemo(() =>
    levelFilterKeys.map((f) => ({ label: t(f.key), value: f.value })),
  [t]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string | undefined>(undefined);
  const [showNoise, setShowNoise] = useState(false);

  // Live tail state. When a tail stream is attached, `liveActive` is true
  // and `liveLogs` (newest-appended) is the primary feed; the store-fed
  // `logs` prop becomes the seed/fallback. When no tail is available
  // (cloud mode, older agent, no EventSource) we keep showing the prop.
  const [liveActive, setLiveActive] = useState(false);
  const [liveLogs, setLiveLogs] = useState<LogEntry[]>([]);
  // Bumped by the retry timer after a tail drops, which re-runs the attach
  // effect. A dropped tail is re-attached on a fixed cadence, forever.
  const [tailAttempt, setTailAttempt] = useState(0);
  // Older rows fetched by the keyset "Load older" control, oldest at index 0.
  const [olderLogs, setOlderLogs] = useState<LogEntry[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const levelFilterRef = useRef(levelFilter);
  levelFilterRef.current = levelFilter;

  // Attach the live tail when a direct client path exists. The log tail
  // rides the direct client only (the config proxy does not forward it),
  // so a detached client — cloud mode included — falls back to the polled
  // prop feed. A dropped or refused stream refreshes the prop feed at once
  // and re-attaches after TAIL_RETRY_MS.
  useEffect(() => {
    setLiveActive(false);
    setLiveLogs([]);
    setOlderLogs([]);
    setOlderCursor(null);
    setHasOlder(false);
    const logging = client?.logging;
    if (!hasClientPath(logging)) return;

    let cancelled = false;
    // Batch arrivals. The agent can burst hundreds of rows a second during
    // a boot or a fault cascade, and one `setLiveLogs` per row is one full
    // copy of a `MAX_LIVE_LINES`-long array plus one React commit each.
    // Draining on an animation frame caps both at the display rate and
    // costs nothing when rows trickle in.
    let pending: LogEntry[] = [];
    let flushHandle: number | null = null;
    const flush = () => {
      flushHandle = null;
      if (cancelled || pending.length === 0) return;
      const batch = pending;
      pending = [];
      setLiveActive(true);
      setLiveLogs((prev) => {
        const next = prev.concat(batch);
        if (next.length > MAX_LIVE_LINES) {
          next.splice(0, next.length - MAX_LIVE_LINES);
        }
        return next;
      });
    };
    const onRow = (row: LoggingRow) => {
      if (cancelled) return;
      pending.push(rowToEntry(row));
      // Never let the pending buffer outgrow the window it feeds.
      if (pending.length > MAX_LIVE_LINES) {
        pending.splice(0, pending.length - MAX_LIVE_LINES);
      }
      if (flushHandle === null) {
        flushHandle = requestAnimationFrame(flush);
      }
    };
    let retryTimer: number | undefined;
    const onError = () => {
      // Stream refused or dropped (e.g. the agent restarted): show current
      // data from the polled feed now, and try the tail again shortly.
      if (cancelled) return;
      setLiveActive(false);
      onRefresh(levelFilterRef.current);
      retryTimer = window.setTimeout(() => setTailAttempt((n) => n + 1), TAIL_RETRY_MS);
    };
    let stream: LogTail;
    try {
      stream = logging.tail(
        { replay: 100, level: levelFilterRef.current },
        { onRow, onError },
      );
    } catch {
      // No host / relayed agent: the polling effect below keeps the prop feed
      // current; refresh once now so it shows current data immediately.
      onRefresh(levelFilterRef.current);
      return;
    }

    return () => {
      cancelled = true;
      if (flushHandle !== null) cancelAnimationFrame(flushHandle);
      window.clearTimeout(retryTimer);
      stream.close();
    };
  }, [client, levelFilter, onRefresh, tailAttempt]);

  // Without a live tail the prop feed is the only source, so refresh it on a
  // fixed cadence while mounted. Cloud mode is excluded: its heartbeat already
  // carries the recent log window.
  useEffect(() => {
    if (liveActive || cloudMode) return;
    const id = setInterval(() => onRefresh(levelFilterRef.current), LOG_POLL_MS);
    return () => clearInterval(id);
  }, [liveActive, cloudMode, onRefresh]);

  // Age of the polled snapshot: stamped (on the shared 1 Hz clock) whenever
  // the prop feed changes, so a non-live viewer says how old its rows are.
  useClockTick();
  const clockNow = useClockStore((s) => s.now);
  const [seenLogs, setSeenLogs] = useState(logs);
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  if (seenLogs !== logs) {
    setSeenLogs(logs);
    setSnapshotAt(clockNow);
  }

  // Seed the "Load older" cursor from the first store/query page so the
  // operator can scroll back beyond the live window.
  const primeOlderCursor = useCallback(async () => {
    if (!client?.logging) return;
    try {
      const page = await client.logging.query({
        level: levelFilterRef.current,
        limit: OLDER_PAGE_SIZE,
      });
      setOlderCursor(page.page.next_cursor);
      setHasOlder(page.page.next_cursor !== null);
    } catch {
      setHasOlder(false);
    }
  }, [client]);

  useEffect(() => {
    if (liveActive) void primeOlderCursor();
  }, [liveActive, primeOlderCursor]);

  const loadOlder = useCallback(async () => {
    if (!client?.logging || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await client.logging.query({
        level: levelFilterRef.current,
        limit: OLDER_PAGE_SIZE,
        cursor: olderCursor,
      });
      // Query returns newest-first; prepend reversed so the merged list
      // stays chronological (oldest first).
      const fetched = [...page.data].reverse().map(rowToEntry);
      setOlderLogs((prev) => [...fetched, ...prev]);
      setOlderCursor(page.page.next_cursor);
      setHasOlder(page.page.next_cursor !== null);
    } catch {
      setHasOlder(false);
    } finally {
      setLoadingOlder(false);
    }
  }, [client, olderCursor, loadingOlder]);

  // The source feed: live tail when active, else the polled store prop.
  const sourceLogs = useMemo(() => {
    if (liveActive) return [...olderLogs, ...liveLogs];
    return logs;
  }, [liveActive, olderLogs, liveLogs, logs]);

  // Filter the visible logs (noise suppression).
  const { visibleLogs, suppressedCount } = useMemo(() => {
    if (!Array.isArray(sourceLogs)) return { visibleLogs: [], suppressedCount: 0 };
    if (showNoise) return { visibleLogs: sourceLogs, suppressedCount: 0 };
    let suppressed = 0;
    const filtered = sourceLogs.filter((entry) => {
      if (isNoisyEntry(entry)) {
        suppressed += 1;
        return false;
      }
      return true;
    });
    return { visibleLogs: filtered, suppressedCount: suppressed };
  }, [sourceLogs, showNoise]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLogs, autoScroll]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  }

  // Level-filter clicks update the live stream (re-attaches with the new
  // level) and the polled feed (onRefresh) so both paths track the filter.
  function applyLevelFilter(value: string | undefined) {
    setLevelFilter(value);
    if (!liveActive) onRefresh(value);
  }

  return (
    <div className="border border-border-default rounded-lg flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <h3 className="text-sm font-medium text-text-primary">{t("logs")}</h3>
        {liveActive ? (
          <span
            className="flex items-center gap-1 text-[9px] text-status-success uppercase tracking-wide"
            title={t("liveTail")}
          >
            <Radio size={10} className="animate-pulse" />
            {t("live")}
          </span>
        ) : (
          snapshotAt !== null && (
            <span className="text-[9px] text-text-tertiary">
              {t("logsSnapshotAge", { age: getFreshness(snapshotAt).label })}
            </span>
          )
        )}
        <div className="flex items-center gap-1 ml-2">
          {levelFilters.map((f) => (
            <button
              key={f.label}
              onClick={() => applyLevelFilter(f.value)}
              className={cn(
                "px-2 py-0.5 text-[10px] rounded transition-colors",
                levelFilter === f.value
                  ? "bg-accent-primary/20 text-accent-primary"
                  : "text-text-tertiary hover:text-text-secondary"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        {/* Noise toggle */}
        <button
          onClick={() => setShowNoise((v) => !v)}
          className={cn(
            "ml-auto p-1 transition-colors flex items-center gap-1",
            showNoise
              ? "text-accent-primary"
              : "text-text-tertiary hover:text-text-secondary"
          )}
          title={
            showNoise
              ? "Showing all logs (click to hide hal.usb noise)"
              : suppressedCount > 0
                ? `${suppressedCount} noisy events hidden — click to show`
                : "Hiding noisy events (hal.usb scan, hotplug pre-gate, mavlink streams)"
          }
        >
          {showNoise ? <Eye size={12} /> : <EyeOff size={12} />}
          {!showNoise && suppressedCount > 0 && (
            <span className="text-[9px] font-mono">{suppressedCount}</span>
          )}
        </button>
        <button
          onClick={() => onRefresh(levelFilter)}
          className="p-1 text-text-tertiary hover:text-accent-primary transition-colors"
          title={t("refreshLogs")}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-[240px] overflow-y-auto p-2 font-mono text-[11px] leading-relaxed"
      >
        {liveActive && hasOlder && (
          <div className="flex justify-center pb-1">
            <button
              onClick={loadOlder}
              disabled={loadingOlder}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-text-tertiary hover:text-accent-primary transition-colors disabled:opacity-50"
            >
              <ChevronUp size={10} />
              {loadingOlder ? t("loadingOlder") : t("loadOlder")}
            </button>
          </div>
        )}
        {visibleLogs.length === 0 ? (
          <p className="text-text-tertiary text-center py-4">
            {cloudMode ? t("waitingForLogs") : t("noLogs")}
          </p>
        ) : (
          visibleLogs.map((entry, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="text-text-tertiary shrink-0">
                {formatLogTime(entry.timestamp)}
              </span>
              <span
                className={cn(
                  "shrink-0 w-[52px] uppercase",
                  levelColors[entry.level]
                )}
              >
                {entry.level}
              </span>
              <span className="text-text-tertiary shrink-0">
                [{entry.service}]
              </span>
              <span className="text-text-secondary">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
