"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, EyeOff, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type { LogEntry } from "@/lib/agent/types";

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

// DEC-108 Phase D: noisy info-level events that get auto-suppressed by
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

function isNoisyEntry(entry: LogEntry): boolean {
  if (entry.level !== "info" && entry.level !== "debug") return false;
  return NOISY_PATTERNS.some(
    ([service, message]) =>
      entry.service?.startsWith(service) && entry.message?.startsWith(message)
  );
}

export function LogViewer({ logs, onRefresh }: LogViewerProps) {
  const t = useTranslations("agent");
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);

  const levelFilters = useMemo(() =>
    levelFilterKeys.map((f) => ({ label: t(f.key), value: f.value })),
  [t]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string | undefined>(undefined);
  const [showNoise, setShowNoise] = useState(false);

  // DEC-108 Phase D: filter the visible logs
  const { visibleLogs, suppressedCount } = useMemo(() => {
    if (!Array.isArray(logs)) return { visibleLogs: [], suppressedCount: 0 };
    if (showNoise) return { visibleLogs: logs, suppressedCount: 0 };
    let suppressed = 0;
    const filtered = logs.filter((entry) => {
      if (isNoisyEntry(entry)) {
        suppressed += 1;
        return false;
      }
      return true;
    });
    return { visibleLogs: filtered, suppressedCount: suppressed };
  }, [logs, showNoise]);

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

  return (
    <div className="border border-border-default rounded-lg flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <h3 className="text-sm font-medium text-text-primary">{t("logs")}</h3>
        <div className="flex items-center gap-1 ml-2">
          {levelFilters.map((f) => (
            <button
              key={f.label}
              onClick={() => {
                setLevelFilter(f.value);
                onRefresh(f.value);
              }}
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
        {/* DEC-108 Phase D: noise toggle */}
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
        {visibleLogs.length === 0 ? (
          <p className="text-text-tertiary text-center py-4">
            {cloudMode ? t("waitingForLogs") : t("noLogs")}
          </p>
        ) : (
          visibleLogs.map((entry, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="text-text-tertiary shrink-0">
                {entry.timestamp.slice(11, 19)}
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
