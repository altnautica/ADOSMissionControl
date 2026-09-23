"use client";

/**
 * @module command/blackbox/PushedWindowsList
 * @description Presentational list of durable log windows the operator has
 * explicitly exported to the paired cloud account. Each row shows when it was
 * exported, the kind / session it covers, its row and byte counts, a cloud
 * badge, and a download affordance that resolves a short-lived signed URL on
 * demand. No store or Convex access lives here — the parent owns the reactive
 * read and the signed-URL action and passes results down as props.
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Cloud, Download, Loader2 } from "lucide-react";
import type { LogdWindow } from "@/lib/community-api-logd";

interface PushedWindowsListProps {
  windows: LogdWindow[];
  /** Resolve a signed download URL for one window, or null when unavailable. */
  onDownload?: (id: LogdWindow["_id"]) => Promise<string | null>;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtPushedAt(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

export function PushedWindowsList({
  windows,
  onDownload,
}: PushedWindowsListProps) {
  const t = useTranslations("blackbox");
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDownload(id: LogdWindow["_id"]) {
    if (!onDownload) return;
    setBusyId(id);
    try {
      const url = await onDownload(id);
      if (!url) return;
      const a = document.createElement("a");
      a.href = url;
      a.rel = "noopener";
      a.target = "_blank";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="border border-border-default rounded-lg">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <Cloud size={13} className="text-accent-primary" />
        <span className="text-xs font-medium text-text-primary">
          {t("pushedWindows")}
        </span>
        <span className="text-[10px] font-mono text-text-tertiary">
          {windows.length}
        </span>
      </div>
      <div className="divide-y divide-border-default">
        {windows.map((w) => {
          const label = w.sessionId
            ? `${w.kind} · ${w.sessionId}`
            : w.kind;
          return (
            <div
              key={w._id}
              className="flex items-center gap-3 px-3 py-2 hover:bg-bg-tertiary/40"
            >
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-accent-primary bg-accent-primary/10 shrink-0">
                <Cloud size={10} />
                {t("pushedCloudBadge")}
              </span>
              <div className="flex flex-col min-w-0">
                <span className="text-xs text-text-primary truncate">
                  {label}
                </span>
                <span className="text-[10px] font-mono text-text-tertiary">
                  {fmtPushedAt(w.pushedAt)}
                </span>
              </div>
              <div className="flex-1" />
              <span className="text-[10px] font-mono text-text-tertiary shrink-0">
                {w.rowCount} {t("rows")} · {fmtBytes(w.sizeBytes)}
              </span>
              {onDownload && (
                <button
                  onClick={() => void handleDownload(w._id)}
                  disabled={busyId === w._id}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer disabled:opacity-40 disabled:cursor-default shrink-0"
                  title={t("pushedDownload")}
                >
                  {busyId === w._id ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Download size={11} />
                  )}
                  {t("pushedDownload")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
