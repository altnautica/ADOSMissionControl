"use client";

/**
 * Live, collapsible debug/log panel for the Flash Tool. Renders the
 * append-only flash log (progress events + protocol-level TX/RX trace) from
 * the flash-log store with level filtering, free-text search, a raw-bytes
 * (hex) toggle, copy/download/clear, and auto-scroll that pauses when the
 * user scrolls up. The downloaded `.log` is self-describing for support.
 *
 * @module fc/firmware/FirmwareDebugPanel
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Terminal,
  Copy,
  Download,
  Trash2,
  Binary,
  ChevronDown,
  ChevronRight,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";
import { useFlashLogStore, type FlashLogLevel } from "@/stores/flash-log-store";

const LEVEL_FILTERS: { key: string; value?: FlashLogLevel }[] = [
  { key: "all", value: undefined },
  { key: "info", value: "info" },
  { key: "warning", value: "warning" },
  { key: "error", value: "error" },
];

const LEVEL_COLOR: Record<FlashLogLevel, string> = {
  debug: "text-text-tertiary",
  info: "text-accent-primary",
  warning: "text-status-warning",
  error: "text-status-error",
  success: "text-status-success",
};

function clockTime(ts: number): string {
  return new Date(ts).toTimeString().slice(0, 8);
}

interface FirmwareDebugPanelProps {
  isFlashing: boolean;
  defaultOpen?: boolean;
}

export function FirmwareDebugPanel({ isFlashing, defaultOpen }: FirmwareDebugPanelProps) {
  const t = useTranslations("flashTool.debug");
  const { toast } = useToast();

  const version = useFlashLogStore((s) => s._version);
  const entries = useFlashLogStore((s) => s.entries);
  const clear = useFlashLogStore((s) => s.clear);
  const download = useFlashLogStore((s) => s.download);
  const buildLogText = useFlashLogStore((s) => s.buildLogText);

  const [open, setOpen] = useState(defaultOpen ?? false);
  const [level, setLevel] = useState<FlashLogLevel | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [showHex, setShowHex] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Surface the panel automatically once a flash begins.
  useEffect(() => {
    if (isFlashing) setOpen(true);
  }, [isFlashing]);

  // `entries` is a stable RingBuffer ref; re-read it when `_version` bumps.
  const all = useMemo(() => entries.toArray(), [entries, version]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((e) => {
      if (level && e.level !== level) return false;
      if (q && !`${e.source} ${e.phase ?? ""} ${e.message}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, level, query]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visible, autoScroll]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }

  function jumpToLatest() {
    setAutoScroll(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  async function copyLogs() {
    try {
      await navigator.clipboard.writeText(buildLogText());
      toast(t("copied"), "success");
    } catch {
      toast(t("copyFailed"), "error");
    }
  }

  const empty = all.length === 0;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-bg-secondary border border-border-default text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        data-testid="flash-debug-toggle"
      >
        <ChevronRight size={14} />
        <Terminal size={14} />
        <span className="text-xs font-semibold">{t("title")}</span>
        {isFlashing && <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />}
        <span className="ml-auto text-[10px] text-text-tertiary font-mono">{all.length}</span>
      </button>
    );
  }

  return (
    <div className="bg-bg-secondary border border-border-default" data-testid="flash-debug-panel">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <button
          onClick={() => setOpen(false)}
          className="flex items-center gap-1.5 text-text-secondary hover:text-text-primary cursor-pointer"
          aria-label={t("collapse")}
        >
          <ChevronDown size={14} />
          <Terminal size={14} />
          <span className="text-xs font-semibold">{t("title")}</span>
        </button>
        {isFlashing && (
          <span className="flex items-center gap-1 text-[10px] text-status-success">
            <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-pulse" />
            {t("live")}
          </span>
        )}
        <span className="ml-auto text-[10px] text-text-tertiary font-mono">{visible.length}/{all.length}</span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center flex-wrap gap-1.5 px-3 py-2 border-b border-border-default">
        {LEVEL_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setLevel(f.value)}
            className={cn(
              "px-2 py-0.5 text-[10px] rounded transition-colors cursor-pointer",
              level === f.value
                ? "bg-accent-primary/20 text-accent-primary"
                : "text-text-tertiary hover:text-text-secondary",
            )}
          >
            {t(`filter.${f.key}`)}
          </button>
        ))}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search")}
          className="ml-1 flex-1 min-w-[80px] bg-bg-tertiary border border-border-default px-2 py-0.5 text-[10px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary"
        />
        <button
          onClick={() => setShowHex((v) => !v)}
          title={t("hexToggle")}
          className={cn(
            "p-1 transition-colors cursor-pointer",
            showHex ? "text-accent-primary" : "text-text-tertiary hover:text-text-secondary",
          )}
        >
          <Binary size={12} />
        </button>
        <button
          onClick={copyLogs}
          disabled={empty}
          title={t("copy")}
          className="p-1 text-text-tertiary hover:text-accent-primary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          <Copy size={12} />
        </button>
        <button
          onClick={download}
          disabled={empty}
          title={t("download")}
          className="p-1 text-text-tertiary hover:text-accent-primary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          <Download size={12} />
        </button>
        <button
          onClick={() => clear()}
          disabled={empty || isFlashing}
          title={t("clear")}
          className="p-1 text-text-tertiary hover:text-status-error disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Body */}
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={t("title")}
          className="h-[240px] overflow-y-auto p-2 font-mono text-[11px] leading-relaxed"
        >
          {visible.length === 0 ? (
            <p className="text-text-tertiary text-center py-6">{t("empty")}</p>
          ) : (
            visible.map((e, i) => (
              <div key={i} className="py-0.5">
                <div className="flex gap-2">
                  <span className="text-text-tertiary shrink-0">{clockTime(e.ts)}</span>
                  <span className={cn("shrink-0 w-[56px] uppercase", LEVEL_COLOR[e.level])}>{e.level}</span>
                  <span className="text-text-tertiary shrink-0">
                    [{e.source}]{e.phase ? ` (${e.phase})` : ""}
                  </span>
                  <span className="text-text-secondary break-all">{e.message}</span>
                </div>
                {showHex && e.rawHex && (
                  <div className="pl-[60px] text-text-tertiary break-all">{e.rawHex}</div>
                )}
              </div>
            ))
          )}
        </div>
        {!autoScroll && (
          <button
            onClick={jumpToLatest}
            className="absolute bottom-2 right-3 flex items-center gap-1 px-2 py-1 text-[10px] bg-accent-primary text-accent-foreground rounded shadow cursor-pointer"
          >
            <ArrowDown size={10} />
            {t("jumpToLatest")}
          </button>
        )}
      </div>
    </div>
  );
}
