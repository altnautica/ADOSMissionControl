"use client";

import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agent-store";
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

const levelFilters: Array<{ label: string; value: string | undefined }> = [
  { label: "All", value: undefined },
  { label: "Info", value: "info" },
  { label: "Warning", value: "warning" },
  { label: "Error", value: "error" },
];

export function LogViewer({ logs, onRefresh }: LogViewerProps) {
  const cloudMode = useAgentStore((s) => s.cloudMode);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [levelFilter, setLevelFilter] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 40);
  }

  return (
    <div className="border border-border-default rounded-lg flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <h3 className="text-sm font-medium text-text-primary">Logs</h3>
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
        <button
          onClick={() => onRefresh(levelFilter)}
          className="ml-auto p-1 text-text-tertiary hover:text-accent-primary transition-colors"
          title="Refresh logs"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-[240px] overflow-y-auto p-2 font-mono text-[11px] leading-relaxed"
      >
        {!Array.isArray(logs) || logs.length === 0 ? (
          <p className="text-text-tertiary text-center py-4">
            {cloudMode ? "Waiting for logs from agent..." : "No logs"}
          </p>
        ) : (
          (Array.isArray(logs) ? logs : []).map((entry, i) => (
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
