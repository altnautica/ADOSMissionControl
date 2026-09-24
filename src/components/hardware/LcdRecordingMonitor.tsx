"use client";

/**
 * @module LcdRecordingMonitor
 * @description Card that mirrors the agent's recording state: a
 * status badge driven by the heartbeat (Recording / Idle), a
 * scrollable list of recordings on disk newest-first, and a
 * Start/Stop toggle.
 *
 * The button is disabled when no video stream is publishing because
 * the agent rejects the start request in that state. The list is
 * fetched once on mount and on every successful start/stop so the
 * card converges without a heavy poll loop.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Disc, RefreshCw, Loader2 } from "lucide-react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useToast } from "@/components/ui/toast";
import type { RecordingFileEntry } from "@/lib/agent/client";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let u = 0;
  let v = bytes;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`;
}

function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatStarted(item: RecordingFileEntry): string | null {
  const ts = item.started_at ?? item.mtime;
  if (!ts) return null;
  // mtime is Unix seconds; started_at is too. Convert both to ms.
  const ms = ts < 1e12 ? ts * 1000 : ts;
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return null;
  }
}

export function LcdRecordingMonitor() {
  const client = useAgentConnectionStore((s) => s.client);
  const videoRecording = useAgentCapabilitiesStore((s) => s.videoRecording);
  const t = useTranslations("hardware.lcdRecordingMonitor");
  const { toast } = useToast();

  const [items, setItems] = useState<RecordingFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [optimisticRecording, setOptimisticRecording] = useState<boolean | null>(
    null,
  );
  const [streamPublishing, setStreamPublishing] = useState<boolean | null>(null);

  const isRecording = optimisticRecording ?? Boolean(videoRecording);

  const fetchList = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    try {
      const res = await client.listRecordings();
      const sorted = [...(res.items ?? [])].sort(
        (a, b) => (b.mtime ?? 0) - (a.mtime ?? 0),
      );
      setItems(sorted);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("listError");
      toast(msg, "error");
    } finally {
      setLoading(false);
    }
  }, [client, t, toast]);

  // Probe the video pipeline once so we can disable Start when no
  // stream is publishing. Safe-fall on agents that don't expose the
  // route (older builds or alternate profiles).
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    void client.getVideoStatus().then((status) => {
      if (cancelled) return;
      if (!status) {
        setStreamPublishing(null);
        return;
      }
      setStreamPublishing(status.state === "running");
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Drop the optimistic shadow when the heartbeat catches up.
  useEffect(() => {
    if (optimisticRecording == null) return;
    if (videoRecording === optimisticRecording) {
      setOptimisticRecording(null);
    }
  }, [videoRecording, optimisticRecording]);

  // Fetch the list on mount and whenever the recording state flips.
  useEffect(() => {
    if (!client) return;
    void fetchList();
  }, [client, videoRecording, fetchList]);

  const onStart = async () => {
    if (!client || pending || isRecording) return;
    setOptimisticRecording(true);
    setPending(true);
    try {
      await client.startRecording();
      void fetchList();
    } catch (err) {
      setOptimisticRecording(false);
      const msg = err instanceof Error ? err.message : t("startError");
      toast(msg, "error");
    } finally {
      setPending(false);
    }
  };

  const onStop = async () => {
    if (!client || pending || !isRecording) return;
    setOptimisticRecording(false);
    setPending(true);
    try {
      await client.stopRecording();
      void fetchList();
    } catch (err) {
      setOptimisticRecording(true);
      const msg = err instanceof Error ? err.message : t("stopError");
      toast(msg, "error");
    } finally {
      setPending(false);
    }
  };

  // streamPublishing === null means we couldn't probe (not all agents
  // expose /api/video). Don't block the button in that case.
  const startDisabled = !client || pending || streamPublishing === false;

  return (
    <section className="flex flex-col rounded border border-border-default bg-bg-secondary">
      <header className="flex items-center justify-between border-b border-border-default px-4 py-3">
        <div className="flex items-center gap-2">
          <Disc size={16} className="text-accent-primary" />
          <h2 className="text-sm font-display font-semibold text-text-primary">
            {t("title")}
          </h2>
        </div>
        <span
          data-testid="recording-badge"
          data-recording={isRecording}
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            isRecording
              ? "bg-status-error/15 text-status-error"
              : "bg-bg-tertiary text-text-tertiary",
          )}
        >
          {isRecording ? t("badgeRecording") : t("badgeIdle")}
        </span>
      </header>

      <div className="flex flex-col gap-3 px-4 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {isRecording ? (
            <button
              type="button"
              onClick={() => void onStop()}
              disabled={!client || pending}
              data-testid="stop-recording"
              className={cn(
                "rounded border border-status-error/40 bg-status-error/15 px-3 py-1.5 text-xs font-medium text-status-error",
                "hover:bg-status-error/25 transition-colors",
                (!client || pending) && "cursor-not-allowed opacity-60",
              )}
            >
              {t("stopRecording")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onStart()}
              disabled={startDisabled}
              data-testid="start-recording"
              className={cn(
                "rounded border border-border-default bg-bg-tertiary px-3 py-1.5 text-xs font-medium text-text-primary",
                "hover:border-accent-primary/40 transition-colors",
                startDisabled && "cursor-not-allowed opacity-60",
              )}
            >
              {t("startRecording")}
            </button>
          )}
          <button
            type="button"
            onClick={() => void fetchList()}
            disabled={!client || loading}
            className={cn(
              "flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-text-secondary",
              "border border-border-default hover:border-accent-primary/40 hover:text-text-primary",
              (!client || loading) && "cursor-not-allowed opacity-60",
            )}
            aria-label={t("refresh")}
          >
            {loading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {t("refresh")}
          </button>
        </div>
        {streamPublishing === false && !isRecording ? (
          <p className="text-[11px] text-text-tertiary">
            {t("streamIdleHint")}
          </p>
        ) : null}

        <div
          className="max-h-64 overflow-y-auto rounded border border-border-default bg-bg-tertiary"
          data-testid="recording-list"
        >
          {loading && items.length === 0 ? (
            <p className="px-3 py-3 text-xs text-text-tertiary">
              {t("loading")}
            </p>
          ) : items.length === 0 ? (
            <p className="px-3 py-3 text-xs text-text-tertiary">
              {t("emptyDescription")}
            </p>
          ) : (
            <ul className="divide-y divide-border-default" role="list">
              {items.map((item) => {
                const started = formatStarted(item);
                const dur = formatDuration(item.duration_sec);
                return (
                  <li
                    key={item.filename}
                    className="flex flex-col gap-0.5 px-3 py-2"
                    data-recording-row={item.filename}
                  >
                    <span className="font-mono text-[11px] text-text-primary truncate">
                      {item.filename}
                    </span>
                    <div className="flex flex-wrap items-center gap-3 text-[10px] text-text-tertiary">
                      <span>{formatBytes(item.size_bytes ?? 0)}</span>
                      {dur ? <span>{dur}</span> : null}
                      {started ? <span>{started}</span> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
