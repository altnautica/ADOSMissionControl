"use client";

/**
 * @module atlas/viewers/ViewerLoading
 * @description The loading overlay for a World Model viewer. With a known
 * download size it shows a determinate progress bar (percent + MB), so a
 * multi-hundred-MB reconstruction reads as real progress rather than an
 * indefinite spinner; with no size (or before the first byte) it falls back to
 * the spinner. Driven by the viewer that owns the download — cleared on the
 * first render or swapped for `ViewerError` on failure.
 * @license GPL-3.0-only
 */

import { Loader2 } from "lucide-react";

export interface ViewerLoadingProps {
  /** 0–100 when the download size is known; omit for an indeterminate spinner. */
  percent?: number;
  /** Bytes received so far (shown as MB alongside the total). */
  receivedBytes?: number;
  /** Total bytes when known (shown as MB). */
  totalBytes?: number;
  /** Short phase label, e.g. "Downloading splat". */
  label?: string;
}

const toMb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);

export function ViewerLoading({
  percent,
  receivedBytes,
  totalBytes,
  label,
}: ViewerLoadingProps = {}) {
  const determinate = typeof percent === "number" && Number.isFinite(percent);
  const clamped = determinate ? Math.max(0, Math.min(100, percent)) : 0;
  const haveBytes =
    typeof receivedBytes === "number" &&
    typeof totalBytes === "number" &&
    totalBytes > 0;

  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-primary/40"
      role="status"
      aria-label={label ?? "Loading viewer"}
      aria-live="polite"
    >
      {determinate ? (
        <div className="flex w-48 max-w-[70%] flex-col gap-1.5">
          <div className="h-1 w-full overflow-hidden rounded-full bg-text-tertiary/20">
            <div
              className="h-full rounded-full bg-accent-primary transition-[width] duration-150"
              style={{ width: `${clamped}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-text-tertiary">
            <span>{label ?? "Loading"}</span>
            <span>
              {haveBytes
                ? `${toMb(receivedBytes)} / ${toMb(totalBytes)} MB`
                : `${Math.round(clamped)}%`}
            </span>
          </div>
        </div>
      ) : (
        <Loader2 className="w-5 h-5 animate-spin text-text-tertiary" />
      )}
    </div>
  );
}
