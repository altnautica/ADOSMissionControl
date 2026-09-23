"use client";

import { useCallback, useState } from "react";
import { useDiagnosticsStore } from "@/stores/diagnostics-store";
import { Download, Clipboard, Check } from "lucide-react";
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
  const [copied, setCopied] = useState(false);

  const handleDownload = useCallback(() => {
    const snapshot = buildSnapshot();
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    downloadBlob(blob, `diagnostics-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`);
  }, []);

  const handleCopy = useCallback(async () => {
    const snapshot = buildSnapshot();
    const json = JSON.stringify(snapshot, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
      const textarea = document.createElement("textarea");
      textarea.value = json;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, []);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleDownload}
        className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer border border-border-default hover:border-text-tertiary transition-colors"
      >
        <Download size={10} />
        Export JSON
      </button>
      <button
        onClick={handleCopy}
        className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer border border-border-default hover:border-text-tertiary transition-colors"
      >
        {copied ? <Check size={10} className="text-status-success" /> : <Clipboard size={10} />}
        {copied ? "Copied" : "Copy to Clipboard"}
      </button>
    </div>
  );
}
