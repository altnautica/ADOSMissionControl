"use client";

/**
 * @module command/BlackBoxTab
 * @description The ADOS Black Box view: a durable, post-flight log +
 * telemetry review surface for a paired companion-computer agent. Reads
 * the on-device store through `client.logging` — a session picker, a
 * keyset-paged filtered log table, time-aligned telemetry charts, a
 * health/sync badge, and a streamed export. Degrades gracefully on older
 * agents (no durable store) and in cloud mode (LAN store not reachable).
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useAction } from "convex/react";
import {
  Database,
  Download,
  RefreshCw,
  CircleCheck,
  CircleAlert,
  ChevronDown,
  CloudUpload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSurfaceGate } from "@/hooks/use-surface-gate";
import { agentGateFallback } from "./shared/agent-gate-fallback";
import { useToast } from "@/components/ui/toast";
import { Select } from "@/components/ui/select";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useBlackBoxStore } from "@/stores/blackbox-store";
import { formatLogTime } from "./shared/LogViewer";
import { HistoryChart } from "./blackbox/HistoryChart";
import { PushedWindowsList } from "./blackbox/PushedWindowsList";
import { getLogdWindowsRef, getLogdWindowRef } from "@/lib/community-api-logd";
import type { LogLevel } from "@/lib/agent/agent-client/logging";

const levelColors: Record<LogLevel, string> = {
  debug: "text-text-tertiary",
  info: "text-accent-primary",
  warning: "text-status-warning",
  error: "text-status-error",
};

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

export function BlackBoxTab() {
  const t = useTranslations("blackbox");
  const tAgent = useTranslations("agent");
  const gate = useSurfaceGate("agent-online");
  const { toast } = useToast();
  const cloudMode = useAgentConnectionStore((s) => s.cloudMode);
  const deviceId = useAgentConnectionStore((s) => s.cloudDeviceId);

  const sessions = useBlackBoxStore((s) => s.sessions);
  const selectedSessionId = useBlackBoxStore((s) => s.selectedSessionId);
  const rows = useBlackBoxStore((s) => s.rows);
  const hasMore = useBlackBoxStore((s) => s.hasMore);
  const filters = useBlackBoxStore((s) => s.filters);
  const cpuHistory = useBlackBoxStore((s) => s.cpuHistory);
  const memoryHistory = useBlackBoxStore((s) => s.memoryHistory);
  const stats = useBlackBoxStore((s) => s.stats);
  const health = useBlackBoxStore((s) => s.health);
  const available = useBlackBoxStore((s) => s.available);
  const loadingRows = useBlackBoxStore((s) => s.loadingRows);
  const loadingMore = useBlackBoxStore((s) => s.loadingMore);
  const exporting = useBlackBoxStore((s) => s.exporting);
  const pushState = useBlackBoxStore((s) => s.pushState);

  const setSelectedSession = useBlackBoxStore((s) => s.setSelectedSession);
  const setFilters = useBlackBoxStore((s) => s.setFilters);
  const fetchMore = useBlackBoxStore((s) => s.fetchMore);
  const refresh = useBlackBoxStore((s) => s.refresh);
  const exportWindow = useBlackBoxStore((s) => s.exportWindow);
  const pushWindow = useBlackBoxStore((s) => s.pushWindow);
  const clear = useBlackBoxStore((s) => s.clear);

  // Cloud-read of windows the operator has already exported. Owner-gated
  // server-side and skipped unless this drone has a cloud device id; degrades
  // to undefined (then an empty list) when Convex or the function is absent.
  const pushedWindows = useConvexSkipQuery(getLogdWindowsRef, {
    args: { deviceId: deviceId ?? "" },
    enabled: !!deviceId,
  });
  const getWindowUrl = useAction(getLogdWindowRef);

  // Load on mount; clear on unmount so a freshly-focused agent never shows
  // the previous one's review data.
  useEffect(() => {
    void refresh();
    return () => clear();
  }, [refresh, clear]);

  const sessionOptions = useMemo(() => {
    const all = { value: "", label: t("allSessions") };
    const opts = sessions.map((s) => {
      const span = s.duration_ms !== null
        ? fmtDuration(s.duration_ms)
        : t("open");
      return {
        value: s.id,
        label: `${s.kind} · ${s.id}`,
        description: `${formatLogTime(s.started)} · ${span} · ${s.log_count} ${t("logsShort")}`,
      };
    });
    return [all, ...opts];
  }, [sessions, t]);

  const levelOptions = useMemo(
    () => [
      { value: "", label: tAgent("allLogs") },
      { value: "info", label: tAgent("infoLogs") },
      { value: "warning", label: tAgent("warningLogs") },
      { value: "error", label: tAgent("errorLogs") },
    ],
    [tAgent],
  );

  const blocked = agentGateFallback(gate);
  if (blocked) return blocked;

  async function handleExport() {
    const result = await exportWindow();
    if (!result) {
      toast(t("exportUnavailable"), "warning");
      return;
    }
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(t("exportStarted"), "success");
  }

  async function handlePush() {
    const result = await pushWindow();
    if (!result) {
      const err = useBlackBoxStore.getState().pushError;
      toast(`${t("pushFailed")}${err ? `: ${err}` : ""}`, "warning");
      return;
    }
    toast(
      result.deduped ? t("pushAlreadyStored") : t("pushStarted"),
      "success",
    );
  }

  async function handleDownloadPushed(id: string): Promise<string | null> {
    try {
      const res = await getWindowUrl({ id });
      return res?.url ?? null;
    } catch {
      toast(t("pushedDownloadFailed"), "warning");
      return null;
    }
  }

  const healthy = health?.ok && health.writer_alive && health.integrity;
  const sourceLabel = health?.source ?? null;

  // Push is explicit + account-gated. It needs a cloud device id (the agent
  // must be cloud-paired) and a reachable LAN store. A LAN-only / local-mode
  // drone with no cloud id is the correct default, not an error — the button
  // stays visible but disabled with a "pair to push" tooltip.
  const canPush = !!deviceId && !cloudMode && available;
  const pushTooltip = !deviceId
    ? t("pushNeedsPairing")
    : cloudMode
      ? t("pushNeedsLocal")
      : t("push");
  const windows = pushedWindows ?? [];

  // Cloud mode + no LAN reader, or an older agent without a durable store:
  // show a clear empty state instead of an inert blank surface.
  const showUnavailable = !available && !loadingRows;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border-default bg-bg-secondary flex-wrap">
        <Database size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-primary">
          {t("title")}
        </span>

        {health && (
          <span
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded text-[10px]",
              healthy
                ? "text-status-success bg-status-success/10"
                : "text-status-warning bg-status-warning/10",
            )}
            title={t("storeHealthHint")}
          >
            {healthy ? <CircleCheck size={10} /> : <CircleAlert size={10} />}
            {healthy ? t("storeHealthy") : t("storeDegraded")}
            {sourceLabel && sourceLabel !== "logd" && (
              <span className="opacity-70">({sourceLabel})</span>
            )}
          </span>
        )}
        {stats && (
          <span className="text-[10px] font-mono text-text-tertiary">
            {fmtBytes(stats.db.size_bytes)} ·{" "}
            {(stats.db.row_counts.logs ?? 0).toLocaleString()} {t("logsShort")}
          </span>
        )}

        <div className="flex-1" />

        <button
          onClick={() => void refresh()}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer"
        >
          <RefreshCw size={11} />
          {t("refresh")}
        </button>
        <button
          onClick={() => void handleExport()}
          disabled={exporting || !available}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer disabled:opacity-40 disabled:cursor-default"
        >
          <Download size={11} />
          {exporting ? t("exporting") : t("export")}
        </button>
        <button
          onClick={() => void handlePush()}
          disabled={!canPush || pushState === "pushing"}
          title={pushTooltip}
          className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer disabled:opacity-40 disabled:cursor-default"
        >
          <CloudUpload size={11} />
          {pushState === "pushing" ? t("pushing") : t("push")}
        </button>
      </div>

      {/* Selectors */}
      <div className="flex items-end gap-3 px-4 py-2 border-b border-border-default flex-wrap">
        <div className="min-w-[240px]">
          <Select
            label={t("session")}
            options={sessionOptions}
            value={selectedSessionId ?? ""}
            onChange={(v) => setSelectedSession(v === "" ? null : v)}
            searchable={sessionOptions.length > 8}
          />
        </div>
        <div className="min-w-[140px]">
          <Select
            label={t("level")}
            options={levelOptions}
            value={filters.level ?? ""}
            onChange={(v) => setFilters({ ...filters, level: v === "" ? undefined : v })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-text-tertiary">{t("search")}</label>
          <input
            type="text"
            value={filters.text ?? ""}
            onChange={(e) =>
              setFilters({ ...filters, text: e.target.value || undefined })
            }
            placeholder={t("searchPlaceholder")}
            className="bg-bg-tertiary border border-border-default rounded px-2 py-1.5 text-xs text-text-primary placeholder:text-text-tertiary w-[200px] focus:outline-none focus:border-accent-primary"
          />
        </div>
      </div>

      {/* Body: charts + log table */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {showUnavailable ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
            <Database size={28} className="text-text-tertiary" />
            <span className="text-sm text-text-secondary">
              {cloudMode ? t("cloudUnavailable") : t("unavailable")}
            </span>
            <span className="text-xs text-text-tertiary max-w-md">
              {t("unavailableHint")}
            </span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <HistoryChart
                title={t("cpuHistory")}
                points={cpuHistory}
                color="#3A82FF"
                gradientId="bbCpu"
              />
              <HistoryChart
                title={t("memoryHistory")}
                points={memoryHistory}
                color="#22C55E"
                gradientId="bbMem"
              />
            </div>

            {/* Log table */}
            <div className="border border-border-default rounded-lg">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
                <span className="text-xs font-medium text-text-primary">
                  {t("logs")}
                </span>
                <span className="text-[10px] font-mono text-text-tertiary">
                  {rows.length} {t("rows")}
                </span>
              </div>
              <div className="font-mono text-[11px] leading-relaxed max-h-[420px] overflow-y-auto">
                {rows.length === 0 ? (
                  <p className="text-text-tertiary text-center py-6">
                    {loadingRows ? t("loading") : t("noRows")}
                  </p>
                ) : (
                  rows.map((row) => (
                    <div
                      key={row.id}
                      className="flex gap-2 py-0.5 px-3 hover:bg-bg-tertiary/40"
                    >
                      <span className="text-text-tertiary shrink-0">
                        {formatLogTime(row.ts)}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 w-[52px] uppercase",
                          levelColors[row.level],
                        )}
                      >
                        {row.level}
                      </span>
                      <span className="text-text-tertiary shrink-0">
                        [{row.source}]
                      </span>
                      <span className="text-text-secondary break-all">
                        {row.message}
                      </span>
                    </div>
                  ))
                )}
                {hasMore && (
                  <div className="flex justify-center py-2 border-t border-border-default">
                    <button
                      onClick={() => void fetchMore()}
                      disabled={loadingMore}
                      className="flex items-center gap-1 px-3 py-1 text-[10px] text-text-tertiary hover:text-accent-primary transition-colors disabled:opacity-50"
                    >
                      <ChevronDown size={11} />
                      {loadingMore ? t("loadingMore") : t("loadMore")}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Windows already exported to the paired cloud account. Only
                shown when this drone has a cloud id and has windows. */}
            {deviceId && windows.length > 0 && (
              <PushedWindowsList
                windows={windows}
                onDownload={handleDownloadPushed}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
