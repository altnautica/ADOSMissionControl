"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { Download, Clipboard, Check, X } from "lucide-react";
import { downloadBlob } from "@/lib/download";

function buildSnapshot(): Record<string, unknown> {
  const state = useDiagnosticsStore.getState();

  const events = state.eventTimeline.toArray();
  const messages = state.messageLog.toArray();

  // Summarize messages by type rather than dumping all raw entries
  const msgSummary: Record<string, { count: number; lastSeen: number }> = {};
  for (const m of messages) {
    const key = `${m.msgName} (${m.msgId})`;
    if (!msgSummary[key]) {
      msgSummary[key] = { count: 0, lastSeen: 0 };
    }
    msgSummary[key].count++;
    if (m.timestamp > msgSummary[key].lastSeen) {
      msgSummary[key].lastSeen = m.timestamp;
    }
  }

  // Error counts by category
  const errorCounts: Record<string, number> = {};
  for (const entry of state.connectionLog) {
    if (entry.type === "error" && entry.errorCategory) {
      errorCounts[entry.errorCategory] = (errorCounts[entry.errorCategory] ?? 0) + 1;
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    eventTimeline: events.map((e) => ({
      ...e,
      time: new Date(e.timestamp).toISOString(),
    })),
    messageLogSummary: {
      totalMessages: messages.length,
      byType: msgSummary,
    },
    connectionLog: state.connectionLog.map((c) => ({
      ...c,
      time: new Date(c.timestamp).toISOString(),
    })),
    errorCounts,
    calibrationHistory: state.calibrationHistory.map((c) => ({
      ...c,
      time: new Date(c.timestamp).toISOString(),
    })),
    messageRates: Array.from(state.messageRates.values()).map((r) => ({
      msgId: r.msgId,
      msgName: r.msgName,
      hz: Math.round(r.hz * 10) / 10,
    })),
    performanceMetrics: state.performanceMetrics,
    commandQueueSnapshot: state.commandQueueSnapshot,
    ringBufferInfo: state.ringBufferInfo,
  };
}

export function DiagnosticsExport() {
  const t = useTranslations("diagnosticsExport");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const handleDownload = useCallback(() => {
    const snapshot = buildSnapshot();
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    downloadBlob(blob, `diagnostics-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`);
  }, []);

  const handleCopy = useCallback(async () => {
    const snapshot = buildSnapshot();
    const json = JSON.stringify(snapshot, null, 2);
    let ok: boolean;
    try {
      await navigator.clipboard.writeText(json);
      ok = true;
    } catch {
      // Fallback for non-secure contexts. execCommand reports whether the
      // copy happened; a refused copy is shown as a failure, not "Copied".
      const textarea = document.createElement("textarea");
      textarea.value = json;
      document.body.appendChild(textarea);
      textarea.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      document.body.removeChild(textarea);
    }
    setCopyState(ok ? "copied" : "failed");
    setTimeout(() => setCopyState("idle"), 2000);
  }, []);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleDownload}
        className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer border border-border-default hover:border-text-tertiary transition-colors"
      >
        <Download size={10} />
        {t("exportJson")}
      </button>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer border border-border-default hover:border-text-tertiary transition-colors"
      >
        {copyState === "copied" ? (
          <Check size={10} className="text-status-success" />
        ) : copyState === "failed" ? (
          <X size={10} className="text-status-error" />
        ) : (
          <Clipboard size={10} />
        )}
        <span className={copyState === "failed" ? "text-status-error" : undefined}>
          {copyState === "copied"
            ? t("copied")
            : copyState === "failed"
              ? t("copyFailed")
              : t("copyToClipboard")}
        </span>
      </button>
    </div>
  );
}
