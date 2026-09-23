/**
 * @module components/mcp/watch/McpActivityPanel
 * @description The right-rail "MCP Activity" panel body — a live, newest-first
 * feed of every tool the MCP runs, tailed from the local file (LOCAL-FIRST).
 * Each row states the effect in plain language with a binary status dot, jumps
 * to the surface it touched on click, and expands to an observability detail
 * (tool, target, args, result, latency). A header Follow toggle turns on
 * auto-navigation; type filters + a replay stepper aid review. Channel states
 * (waiting / connecting / unavailable) render an honest hint, not an empty pane.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Navigation,
  Map as MapIcon,
  SlidersHorizontal,
  Search,
  Activity,
  MonitorOff,
  Crosshair,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  ExternalLink,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusDot } from "@/components/ui/status-dot";
import { useClockTick } from "@/lib/agent/freshness";
import { useMcpActivityStore } from "@/stores/mcp-activity-store";
import { useMcpFollowStore } from "@/stores/mcp-follow-store";
import { canNavigateToRow, navigateToRow, nodeDisplayName } from "@/lib/mcp/navigate";
import { decisionStatus, type McpActivityRow, type McpCategory } from "@/lib/mcp/activity";

const CATEGORY_ICON: Record<McpCategory, typeof Activity> = {
  drone: Navigation,
  mission: MapIcon,
  config: SlidersHorizontal,
  query: Search,
  other: Activity,
};

type Filter = "all" | McpCategory;
const FILTERS: Filter[] = ["all", "drone", "mission", "config", "query"];
const FILTER_KEY: Record<Filter, string> = {
  all: "filterAll",
  drone: "filterDrone",
  mission: "filterMission",
  config: "filterConfig",
  query: "filterQuery",
  other: "filterAll",
};

function formatAgo(tsUs: number): string {
  const s = Math.max(0, Math.round((Date.now() - tsUs / 1000) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 text-text-tertiary">{label}</span>
      <span className="min-w-0 flex-1 break-words font-mono text-text-secondary">{value}</span>
    </div>
  );
}

function ActivityRow({
  row,
  flash,
  expanded,
  onToggle,
}: {
  row: McpActivityRow;
  flash: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("mcp");
  const Icon = CATEGORY_ICON[row.category];
  // Re-evaluated on the panel's 1 Hz tick, so a node joining the fleet (or the
  // agent connecting) enables the jump within a second.
  const canJump = canNavigateToRow(row);

  const argsText = (() => {
    try {
      return JSON.stringify(row.args);
    } catch {
      return "{…}";
    }
  })();

  return (
    <div className={cn("border-b border-border-default/60", flash && "ados-mcp-flash", row.lifecycle === "error" && "bg-status-error/5")}>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => navigateToRow(row)}
          disabled={!canJump}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left transition-colors",
            canJump ? "hover:bg-bg-tertiary cursor-pointer" : "cursor-default",
          )}
        >
          <StatusDot
            status={decisionStatus(row.decision, row.lifecycle)}
            pulse={row.lifecycle === "running"}
            size="sm"
          />
          <Icon size={13} className="shrink-0 text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate text-xs text-text-primary">{row.summary}</span>
          <span className="shrink-0 max-w-[64px] truncate text-[10px] text-text-tertiary">
            {nodeDisplayName(row.node)}
          </span>
          <span className="shrink-0 tabular-nums text-[10px] text-text-tertiary">{formatAgo(row.tsUs)}</span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          title={t("watch.tool")}
          aria-expanded={expanded}
          className="flex shrink-0 items-center px-1.5 text-text-tertiary hover:text-text-secondary transition-colors"
        >
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
      </div>
      {expanded && (
        <div className="space-y-1 border-t border-border-default/40 bg-bg-primary px-3 py-2 text-[11px]">
          <DetailRow label={t("watch.tool")} value={row.tool} />
          <DetailRow label={t("watch.node")} value={row.node} />
          {argsText !== "{}" && <DetailRow label={t("watch.args")} value={argsText} />}
          {row.result && <DetailRow label={t("watch.result")} value={row.result} />}
          <DetailRow label={t("watch.latency")} value={`${row.latencyMs} ms`} />
          <div className="flex items-center gap-3 pt-1">
            {canJump && (
              <button
                type="button"
                onClick={() => navigateToRow(row)}
                className="flex items-center gap-1 text-accent-primary hover:underline"
              >
                <ExternalLink size={11} />
                {t("watch.jumpToSurface")}
              </button>
            )}
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(argsText)}
              className="flex items-center gap-1 text-text-tertiary hover:text-text-secondary"
            >
              <Copy size={11} />
              {t("watch.copy")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function McpActivityPanel() {
  const t = useTranslations("mcp");
  const events = useMcpActivityStore((s) => s.events);
  const channelState = useMcpActivityStore((s) => s.channelState);
  const followLock = useMcpFollowStore((s) => s.followLock);
  const toggleFollow = useMcpFollowStore((s) => s.toggleFollowLock);
  const flashId = useMcpFollowStore((s) => s.flashId);
  useClockTick(); // one 1Hz tick re-renders the panel so "Xs" labels count up

  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = [...events].reverse();
    return filter === "all" ? all : all.filter((r) => r.category === filter);
  }, [events, filter]);

  if (channelState === "unavailable") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <MonitorOff size={22} className="text-text-tertiary" />
        <p className="text-sm font-medium text-text-secondary">{t("watch.unavailable")}</p>
        <p className="max-w-[18rem] text-xs leading-relaxed text-text-tertiary">
          {t("watch.unavailableHint")}
        </p>
      </div>
    );
  }

  const stepReplay = (dir: -1 | 1) => {
    if (rows.length === 0) return;
    const idx = rows.findIndex((r) => r.id === expandedId);
    const next = idx === -1 ? 0 : Math.max(0, Math.min(rows.length - 1, idx + dir));
    const row = rows[next];
    setExpandedId(row.id);
    navigateToRow(row);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header: subtitle + Follow toggle */}
      <div className="flex items-center justify-between gap-2 border-b border-border-default/60 px-3 py-1.5 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
          {t("watch.subtitle")}
        </span>
        <button
          type="button"
          onClick={toggleFollow}
          title={t("watch.followHint")}
          aria-pressed={followLock}
          className={cn(
            "flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
            followLock
              ? "border-accent-primary/60 bg-accent-primary/10 text-accent-primary"
              : "border-border-default text-text-tertiary hover:text-text-secondary",
          )}
        >
          <Crosshair size={11} />
          {t("watch.follow")}
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex items-center gap-1 border-b border-border-default/60 px-2 py-1 shrink-0">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
              filter === f
                ? "bg-accent-primary/15 text-accent-primary"
                : "text-text-tertiary hover:text-text-secondary",
            )}
          >
            {t(`watch.${FILTER_KEY[f]}`)}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <Activity size={20} className="animate-pulse text-text-tertiary" />
          <p className="text-xs text-text-tertiary">
            {channelState === "connecting" ? t("watch.connecting") : t("watch.waiting")}
          </p>
          <p className="max-w-[16rem] text-[11px] leading-relaxed text-text-tertiary/70">
            {t("watch.waitingHint")}
          </p>
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto">
            {rows.map((row) => (
              <ActivityRow
                key={row.id}
                row={row}
                flash={row.id === flashId}
                expanded={expandedId === row.id}
                onToggle={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
              />
            ))}
          </div>
          {/* Replay stepper — walk past events + re-highlight their surface. */}
          <div className="flex items-center justify-center gap-3 border-t border-border-default/60 px-3 py-1.5 shrink-0">
            <button
              type="button"
              onClick={() => stepReplay(1)}
              title={t("watch.replay")}
              className="text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
              {t("watch.replay")}
            </span>
            <button
              type="button"
              onClick={() => stepReplay(-1)}
              title={t("watch.replay")}
              className="text-text-tertiary hover:text-text-secondary transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
