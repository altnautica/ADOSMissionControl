"use client";

import { X } from "lucide-react";
import type { FlashProgress } from "@/lib/protocol/firmware/types";

const PHASE_LABELS: Record<string, string> = {
  idle: "Ready",
  backup: "Backing up parameters...",
  rebooting: "Rebooting to bootloader...",
  bootloader_wait: "Waiting for bootloader...",
  bootloader_init: "Connecting to bootloader...",
  chip_detect: "Detecting chip...",
  erasing: "Erasing flash...",
  flashing: "Writing firmware...",
  verifying: "Verifying...",
  restarting: "Restarting...",
  restoring: "Restoring parameters...",
  done: "Firmware update complete!",
  error: "Flash failed",
};

interface FirmwareFlashProgressProps {
  progress: FlashProgress;
  isFlashing: boolean;
  onAbort: () => void;
}

export function FirmwareFlashProgress({ progress, isFlashing, onAbort }: FirmwareFlashProgressProps) {
  return (
    <div className="bg-bg-secondary border border-border-default p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-primary">
          {PHASE_LABELS[progress.phase] || progress.phase}
        </span>
        <div className="flex items-center gap-2">
          {progress.phase !== "error" && progress.phase !== "done" && (
            <span className="text-xs font-mono text-text-tertiary">{progress.percent}%</span>
          )}
          {isFlashing && progress.phase !== "done" && progress.phase !== "error" && (
            <button
              onClick={onAbort}
              className="flex items-center gap-1 px-2 py-0.5 text-[10px] border border-status-danger/50 text-status-danger hover:bg-status-danger/10 cursor-pointer"
            >
              <X size={10} />
              Cancel
            </button>
          )}
        </div>
      </div>
      <div className="w-full bg-bg-tertiary h-2">
        <div
          className={`h-full transition-all duration-300 ${
            progress.phase === "error"
              ? "bg-status-danger"
              : progress.phase === "done"
              ? "bg-status-success"
              : progress.phase === "bootloader_wait"
              ? "bg-accent-primary animate-pulse"
              : "bg-accent-primary"
          }`}
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      {progress.phase === "bootloader_wait" && (
        <p className="text-[10px] text-text-tertiary">
          The flight controller is rebooting. This usually takes a few seconds.
          If it takes longer than 10s, you may need to manually enter bootloader mode
          (hold BOOT button while plugging in USB).
        </p>
      )}
      {progress.message && (
        <p className="text-[10px] text-text-tertiary font-mono whitespace-pre-wrap">{progress.message}</p>
      )}
      {progress.bytesWritten != null && progress.bytesTotal != null && (
        <p className="text-[10px] text-text-tertiary font-mono">
          {(progress.bytesWritten / 1024).toFixed(1)} / {(progress.bytesTotal / 1024).toFixed(1)} KB
        </p>
      )}
    </div>
  );
}
