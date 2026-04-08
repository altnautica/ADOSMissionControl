"use client";

/**
 * Onboard dataflash log browser modal.
 *
 * Lists logs on the connected ArduPilot FC, lets the user select one or
 * more, downloads them through the existing protocol layer, parses the
 * binary, splits into FlightRecords, and ingests via the history store.
 *
 * Phase 11 — real hardware only. The "no mocks" rule means demo / mock
 * protocols surface a banner and refuse to download.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, RefreshCcw, Download, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { isDemoMode } from "@/lib/utils";
import { importDataflashLog, type DataflashImportSummary } from "@/lib/dataflash/import";
import type { LogEntry } from "@/lib/protocol/types/mission";

interface LogBrowserProps {
  open: boolean;
  onClose: () => void;
}

interface DownloadProgress {
  logId: number;
  received: number;
  total: number;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtTimestamp(secs: number): string {
  if (!secs) return "—";
  return new Date(secs * 1000).toLocaleString();
}

export function LogBrowser({ open, onClose }: LogBrowserProps) {
  const t = useTranslations("history");
  const selectedDrone = useDroneManager((s) => s.getSelectedDrone());
  const armState = useDroneStore((s) => s.armState);
  const isArmed = armState === "armed";

  const [logs, setLogs] = useState<LogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<DataflashImportSummary | null>(null);

  const isMockOrDemo = isDemoMode() || !selectedDrone;

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Reset state when modal opens.
  useEffect(() => {
    if (open) {
      setLogs(null);
      setError(null);
      setSelectedIds(new Set());
      setProgress(null);
      setSummary(null);
    }
  }, [open]);

  const handleRefresh = useCallback(async () => {
    if (!selectedDrone || isDemoMode() || isArmed) return;
    setLoading(true);
    setError(null);
    try {
      const list = await selectedDrone.protocol.getLogList();
      setLogs(list);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedDrone, isArmed]);

  const handleDownload = useCallback(async () => {
    if (!selectedDrone || selectedIds.size === 0 || isArmed) return;
    setImporting(true);
    setError(null);
    setSummary(null);

    try {
      let totalImported = 0;
      let totalBytes = 0;
      let rcInMissing = false;
      for (const id of selectedIds) {
        setProgress({ logId: id, received: 0, total: logs?.find((l) => l.id === id)?.size ?? 0 });
        const buffer = await selectedDrone.protocol.downloadLog(id, (received, total) => {
          setProgress({ logId: id, received, total });
        });
        if (buffer.byteLength === 0) {
          throw new Error(`Log ${id} downloaded with 0 bytes — flight controller may not have data for it.`);
        }
        const result = await importDataflashLog(buffer, {
          sourceFilename: `log-${id}.bin`,
          droneId: selectedDrone.id,
          droneName: selectedDrone.name,
        });
        totalImported += result.flightsImported;
        totalBytes += result.bytesParsed;
        if (result.rcInMissing) rcInMissing = true;
      }
      setSummary({
        flightsImported: totalImported,
        bytesParsed: totalBytes,
        resyncSkipped: 0,
        rcInMissing,
        paramCount: 0,
      });
      setProgress(null);
    } catch (err) {
      setError((err as Error).message);
      setProgress(null);
    } finally {
      setImporting(false);
    }
  }, [selectedDrone, selectedIds, logs, isArmed]);

  const handleCancel = useCallback(() => {
    selectedDrone?.protocol.cancelLogDownload();
    setImporting(false);
    setProgress(null);
  }, [selectedDrone]);

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[640px] max-w-[95vw] max-h-[85vh] overflow-y-auto rounded-md border border-border-default bg-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border-default sticky top-0 bg-bg-secondary z-10">
          <h3 className="text-xs font-semibold text-text-primary uppercase tracking-wider">
            {t("logBrowserTitle")}
          </h3>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors p-1"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          {isMockOrDemo && (
            <div className="rounded border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-[11px] text-text-secondary flex items-start gap-2">
              <AlertTriangle size={12} className="text-status-warning mt-0.5 shrink-0" />
              {isDemoMode() ? t("logBrowserMockNotice") : t("logBrowserNoDrone")}
            </div>
          )}

          {selectedDrone && !isDemoMode() && isArmed && (
            <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-[11px] text-text-secondary flex items-start gap-2">
              <AlertTriangle size={12} className="text-status-error mt-0.5 shrink-0" />
              {t("logBrowserArmedRefuse")}
            </div>
          )}

          {!isMockOrDemo && !isArmed && (
            <Card title={selectedDrone?.name ?? "Drone"} padding={true}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] text-text-secondary">
                  {logs ? `${logs.length} logs on FC` : "No list loaded yet"}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCcw size={12} />}
                  onClick={handleRefresh}
                  disabled={loading}
                >
                  {loading ? "…" : t("logBrowserRefresh")}
                </Button>
              </div>
              {logs && logs.length === 0 && (
                <p className="text-[10px] text-text-tertiary">{t("logBrowserNoLogs")}</p>
              )}
              {logs && logs.length > 0 && (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border-default">
                      <th className="px-2 py-1.5 w-[24px]" />
                      <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">ID</th>
                      <th className="px-2 py-1.5 text-left text-[10px] uppercase text-text-secondary">Time</th>
                      <th className="px-2 py-1.5 text-right text-[10px] uppercase text-text-secondary">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr
                        key={log.id}
                        className="border-b border-border-default cursor-pointer hover:bg-bg-tertiary"
                        onClick={() => toggleSelect(log.id)}
                      >
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(log.id)}
                            onChange={() => toggleSelect(log.id)}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </td>
                        <td className="px-2 py-1.5 font-mono text-text-primary">{log.id}</td>
                        <td className="px-2 py-1.5 text-text-secondary">{fmtTimestamp(log.timeUtc)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-text-primary">{fmtBytes(log.size)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          )}

          {progress && (
            <Card title="Download" padding={true}>
              <p className="text-[11px] text-text-secondary mb-2">
                {t("logBrowserDownloading", {
                  received: fmtBytes(progress.received),
                  total: fmtBytes(progress.total),
                })}
              </p>
              <div className="w-full h-2 bg-bg-tertiary rounded overflow-hidden">
                <div
                  className="h-full bg-accent-primary transition-all"
                  style={{
                    width: `${progress.total > 0 ? Math.min(100, (progress.received / progress.total) * 100) : 0}%`,
                  }}
                />
              </div>
              <Button variant="ghost" size="sm" onClick={handleCancel} className="mt-2">
                {t("logBrowserCancel")}
              </Button>
            </Card>
          )}

          {error && (
            <div className="rounded border border-status-error/40 bg-status-error/10 px-3 py-2 text-[11px] text-status-error">
              {t("logBrowserParseError", { message: error })}
            </div>
          )}

          {summary && summary.flightsImported > 0 && (
            <div className="rounded border border-status-success/40 bg-status-success/10 px-3 py-2 text-[11px] text-text-secondary">
              <Badge variant="success" size="sm">✓</Badge>{" "}
              {t("logBrowserSuccess", {
                flights: summary.flightsImported,
                bytes: fmtBytes(summary.bytesParsed),
              })}
              {summary.rcInMissing && (
                <p className="mt-1 text-text-tertiary">{t("logBrowserRcInMissing")}</p>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t("clear")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Download size={12} />}
              disabled={
                isMockOrDemo || isArmed || importing || selectedIds.size === 0
              }
              onClick={handleDownload}
            >
              {importing
                ? "Importing…"
                : `${t("logBrowserDownload")} (${selectedIds.size})`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
