"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, EyeOff, Eye, Radio, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { hasClientPath } from "@/lib/agent/config-access";
import type { LogEntry } from "@/lib/agent/types";
import type { LoggingRow } from "@/lib/agent/agent-client/logging";

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

// Render a log entry's timestamp as HH:MM:SS, tolerating either an
// ISO-8601 string or a raw epoch number. Older agents emitted the
// timestamp as a float epoch, which would crash a naive `.slice()`.
// Returns "" for anything unparseable so a malformed entry never throws.
export function formatLogTime(ts: unknown): string {
  if (typeof ts === "string") {
    // ISO-8601: "2026-05-24T09:30:00+00:00" → take HH:MM:SS.
    if (ts.includes("T") && ts.length >= 19) return ts.slice(11, 19);
    const asNum = Number(ts);
    if (Number.isFinite(asNum)) return formatLogTime(asNum);
    return "";
  }
  if (typeof ts === "number" && Number.isFinite(ts)) {
    // Heuristic: values below 1e12 are epoch seconds, not milliseconds.
    const ms = ts < 1e12 ? ts * 1000 : ts;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return "";
    return d.toTimeString().slice(0, 8);
  }
  return "";
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
  // prop feed. On any error or when no tail source exists, drop back by
  // leaving liveActive false and triggering a refresh.
  useEffect(() => {
    setLiveActive(false);
    setLiveLogs([]);
    setOlderLogs([]);
    setOlderCursor(null);
    setHasOlder(false);
    const logging = client?.logging;
    if (!hasClientPath(logging)) return;

    let es: EventSource | null = null;
    let cancelled = false;
    try {
      es = logging.tail({ replay: 100, level: levelFilterRef.current });
    } catch {
      // No EventSource / no host — fall back to polling.
      onRefresh(levelFilterRef.current);
      return;
    }
    const stream = es;
    const onMessage = (ev: MessageEvent) => {
      if (cancelled) return;
      try {
        const row = JSON.parse(ev.data) as LoggingRow;
        if (!row || typeof row.message !== "string") return;
        setLiveActive(true);
        setLiveLogs((prev) => {
          const next = [...prev, rowToEntry(row)];
          if (next.length > MAX_LIVE_LINES) {
            next.splice(0, next.length - MAX_LIVE_LINES);
          }
          return next;
        });
      } catch {
        /* tolerate a malformed frame */
      }
    };
    const onError = () => {
      // Stream dropped: close, fall back to the polled feed, and refresh
      // once so the prop shows current data immediately.
      stream.close();
      if (cancelled) return;
      setLiveActive(false);
      onRefresh(levelFilterRef.current);
    };
    stream.addEventListener("message", onMessage);
    stream.addEventListener("error", onError);

    return () => {
      cancelled = true;
      stream.removeEventListener("message", onMessage);
      stream.removeEventListener("error", onError);
      stream.close();
    };
  }, [client, levelFilter, onRefresh]);

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
        {liveActive && (
          <span
            className="flex items-center gap-1 text-[9px] text-status-success uppercase tracking-wide"
            title={t("liveTail")}
          >
            <Radio size={10} className="animate-pulse" />
            {t("live")}
          </span>
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
