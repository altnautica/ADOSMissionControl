"use client";

/**
 * Staged flash-progress view: a per-stage checklist (detect -> erase -> write
 * -> verify -> finish) with live byte counts and an ETA on the active stage,
 * plus two interactive sub-states:
 *   - "Waiting for device" while the board re-enumerates into its bootloader
 *     (framed as expected, not an error);
 *   - "Select device" when automatic recovery needs a user gesture to open the
 *     re-enumerated bootloader/DFU device.
 *
 * @module fc/firmware/FirmwareFlashProgress
 */

import { useRef } from "react";
import { X, Check, Loader2, Circle, AlertTriangle, Usb } from "lucide-react";
import { useTranslations } from "next-intl";
import type { FlashPhase, FlashProgress } from "@/lib/protocol/firmware/types";

/** Ordered display stages, each mapping to one or more flow phases. */
const STAGES: { key: string; phases: FlashPhase[] }[] = [
  { key: "detect", phases: ["backup", "rebooting", "bootloader_wait", "bootloader_init", "chip_detect"] },
  { key: "erase", phases: ["erasing"] },
  { key: "write", phases: ["flashing"] },
  { key: "verify", phases: ["verifying"] },
  { key: "finish", phases: ["restarting", "restoring", "done"] },
];

function stageIndexForPhase(phase: FlashPhase): number {
  const idx = STAGES.findIndex((s) => s.phases.includes(phase));
  return idx === -1 ? 0 : idx;
}

interface FirmwareFlashProgressProps {
  progress: FlashProgress;
  isFlashing: boolean;
  onAbort: () => void;
  onSelectBootloader?: () => void;
}

export function FirmwareFlashProgress({
  progress,
  isFlashing,
  onAbort,
  onSelectBootloader,
}: FirmwareFlashProgressProps) {
  const t = useTranslations("flashTool.flashProgress");
  const etaRef = useRef<{ ts: number; bytes: number } | null>(null);

  const isError = progress.phase === "error";
  const isDone = progress.phase === "done";
  const activeStage = isDone ? STAGES.length : stageIndexForPhase(progress.phase);
  const waiting = progress.phase === "bootloader_wait" && !progress.action;
  const needsSelect = !!progress.action;

  // ETA: anchor on the first write tick, then extrapolate from the rate.
  let etaText = "";
  if (progress.phase === "flashing" && progress.bytesWritten != null && progress.bytesTotal != null) {
    if (!etaRef.current && progress.bytesWritten > 0) {
      etaRef.current = { ts: Date.now(), bytes: progress.bytesWritten };
    }
    const anchor = etaRef.current;
    if (anchor) {
      const elapsed = (Date.now() - anchor.ts) / 1000;
      const done = progress.bytesWritten - anchor.bytes;
      const rate = elapsed > 0 ? done / elapsed : 0;
      if (rate > 0) {
        const remaining = Math.max(0, Math.round((progress.bytesTotal - progress.bytesWritten) / rate));
        etaText = t("eta", { seconds: remaining });
      }
    }
  } else if (progress.phase !== "flashing") {
    etaRef.current = null;
  }

  return (
    <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
      {/* Header: overall percent + cancel */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-primary">
          {isDone ? t("done") : isError ? t("failed") : t("flashing")}
        </span>
        <div className="flex items-center gap-2">
          {!isError && !isDone && (
            <span className="text-xs font-mono text-text-tertiary">{progress.percent}%</span>
          )}
          {isFlashing && !isDone && !isError && (
            <button
              onClick={onAbort}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] border border-status-error/50 text-status-error hover:bg-status-error/10 cursor-pointer"
            >
              <X size={10} />
              {t("cancel")}
            </button>
          )}
        </div>
      </div>

      {/* Overall bar */}
      <div className="w-full bg-bg-tertiary h-1.5">
        <div
          className={`h-full transition-all duration-300 ${
            isError ? "bg-status-error" : isDone ? "bg-status-success" : waiting ? "bg-accent-primary animate-pulse" : "bg-accent-primary"
          }`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      {/* Stage checklist */}
      <ol className="space-y-1.5" aria-label={t("stagesLabel")}>
        {STAGES.map((stage, i) => {
          const state = isError && i === activeStage ? "error" : i < activeStage || isDone ? "done" : i === activeStage ? "active" : "pending";
          return (
            <li key={stage.key} className="flex items-center gap-2 text-[11px]">
              {state === "done" && <Check size={12} className="text-status-success shrink-0" />}
              {state === "active" && <Loader2 size={12} className="text-accent-primary animate-spin shrink-0" />}
              {state === "pending" && <Circle size={12} className="text-text-tertiary shrink-0" />}
              {state === "error" && <X size={12} className="text-status-error shrink-0" />}
              <span className={state === "pending" ? "text-text-tertiary" : "text-text-secondary"}>
                {t(`stage.${stage.key}`)}
              </span>
              {state === "active" && progress.bytesWritten != null && progress.bytesTotal != null && (
                <span className="ml-auto text-[10px] font-mono text-text-tertiary">
                  {(progress.bytesWritten / 1024).toFixed(0)} / {(progress.bytesTotal / 1024).toFixed(0)} KB
                  {etaText ? ` · ${etaText}` : ""}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {/* Waiting-for-device sub-state (not an error) */}
      {waiting && (
        <div className="flex items-start gap-2 border border-accent-primary/30 bg-accent-primary/5 p-2.5">
          <Loader2 size={14} className="text-accent-primary animate-spin shrink-0 mt-0.5" />
          <p className="text-[10px] text-text-secondary">{t("waitingHint")}</p>
        </div>
      )}

      {/* Select-device action sub-state (needs a user gesture) */}
      {needsSelect && (
        <div
          className="border border-status-warning/40 bg-status-warning/5 p-2.5 space-y-2"
          aria-live="assertive"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-status-warning shrink-0 mt-0.5" />
            <p className="text-[10px] text-text-secondary">{progress.message}</p>
          </div>
          {onSelectBootloader && (
            <button
              onClick={onSelectBootloader}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold bg-accent-primary text-accent-foreground hover:bg-accent-primary/80 cursor-pointer transition-colors"
            >
              <Usb size={12} />
              {t("selectDevice")}
            </button>
          )}
        </div>
      )}

      {/* Latest message line (suppressed while a dedicated sub-state shows it) */}
      {progress.message && !needsSelect && (
        <p className="text-[10px] text-text-tertiary font-mono whitespace-pre-wrap">{progress.message}</p>
      )}
    </div>
  );
}
