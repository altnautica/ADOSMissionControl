"use client";

/**
 * @module DetectionOverlay
 * @description Draws vision detection bounding boxes over a live video
 * pane. Reads the active drone's latest detection batch from the
 * vision-detections store and renders one labelled box per detection,
 * scaled from the source frame resolution onto the rendered video
 * rectangle.
 *
 * The overlay is resolution-independent: each batch declares the frame
 * width/height its boxes are expressed in, and the overlay maps those
 * pixels onto the rectangle the video is ACTUALLY rendered into.
 *
 * That last part is the whole problem this used to get wrong. The video
 * is `object-contain`, so a 16:9 stream in a 4:3 pane paints into a
 * letterboxed sub-rectangle with dead bars above and below — but the
 * boxes were positioned as percentages of the OVERLAY, which spans the
 * whole pane. Every box was then stretched across the bars and offset
 * from the object it was drawn around, by up to the full bar height. On
 * a targeting surface that is a box pointing at the wrong thing. The
 * cockpit overlays already resolve this with `computeRenderedRect`;
 * this one now shares it.
 *
 * Stale batches age out after `staleAfterMs` so a stopped feed does not
 * pin the last frame's boxes on screen forever.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { computeRenderedRect } from "@/components/cockpit/VideoOverlayHost";
import {
  useVisionDetectionsStore,
  type VisionDetection,
} from "@/stores/vision-detections-store";

interface DetectionOverlayProps {
  /** Drone/device id whose detection batch this overlay renders. */
  droneId: string;
  /**
   * Pin the overlay to one pipeline stream (`modelId::cameraId`). When set, the
   * overlay renders that specific model×camera stream instead of the latest
   * batch across all streams — so a multi-camera SBC can preview one pipeline
   * without the others clobbering it. Absent = the latest batch (the default,
   * used by the main flight-video overlay which tracks the designated target).
   */
  streamKey?: string;
  /** Drop boxes older than this (ms). Default 2s. */
  staleAfterMs?: number;
  className?: string;
  /**
   * Click-to-follow handler. When provided, each box becomes clickable and
   * invoking it designates that box as the engine's follow target. When absent,
   * the overlay is read-only (boxes do not intercept pointer events) so the
   * video pane behind it stays interactive.
   */
  onSelectBox?: (detection: VisionDetection, cameraId: string) => void;
}

const DEFAULT_STALE_MS = 2000;

/**
 * Border + text color for a box. A box the tracker has locked is coloured by its
 * lock state (green locked / amber uncertain / red lost) so the follow target
 * stands out; an untracked detection falls back to a confidence ramp.
 */
function boxColorClass(d: VisionDetection): string {
  if (d.trackId != null && d.lockState) {
    if (d.lockState === "locked")
      return "border-status-success text-status-success";
    if (d.lockState === "uncertain")
      return "border-status-warning text-status-warning";
    return "border-status-error text-status-error"; // lost
  }
  if (d.confidence >= 0.7) return "border-accent-primary text-accent-primary";
  if (d.confidence >= 0.4) return "border-status-warning text-status-warning";
  return "border-text-tertiary text-text-tertiary";
}

export function DetectionOverlay({
  droneId,
  streamKey,
  staleAfterMs = DEFAULT_STALE_MS,
  className,
  onSelectBox,
}: DetectionOverlayProps) {
  const batch = useVisionDetectionsStore((s) =>
    streamKey ? s.streams[droneId]?.[streamKey] : s.batches[droneId],
  );

  // A ticking clock so the staleness gate drops boxes once the feed
  // stops, even when no new batch arrives to trigger a store change.
  // Reading the wall clock from state (not Date.now() in render) keeps
  // the render pure.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!batch) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [batch]);

  // The rectangle the video actually paints into, inside this pane.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const measure = () =>
      setSize({ w: wrapper.clientWidth, h: wrapper.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  const rect = useMemo(() => {
    if (!size || !batch || batch.frameWidth <= 0 || batch.frameHeight <= 0) {
      return null;
    }
    return computeRenderedRect(
      size.w,
      size.h,
      batch.frameWidth,
      batch.frameHeight,
    );
  }, [size, batch]);

  const hidden =
    !batch ||
    now - batch.receivedAt > staleAfterMs ||
    batch.frameWidth <= 0 ||
    batch.frameHeight <= 0 ||
    batch.detections.length === 0;

  // The wrapper always renders: it is what `ResizeObserver` measures, and
  // returning null while there are no boxes would drop the measurement and
  // make the first batch after a quiet period paint before the geometry is
  // known — i.e. in the wrong place for one frame.
  return (
    <div
      ref={wrapperRef}
      className={`pointer-events-none absolute inset-0 z-10 ${className ?? ""}`}
      aria-hidden
    >
      {hidden || !rect
        ? null
        : batch.detections.map((d, i) => {
            // A box-less percept (a mask/pose/depth-only reading) has no box
            // to paint here; skip it (mask/keypoint painting is a later
            // surface).
            if (!d.bbox) return null;
            // Source-frame pixels → fractions of the frame, clamped so a box
            // overrunning the frame edge does not paint outside the video,
            // then scaled and offset onto the rendered (letterboxed) rect.
            const fx = Math.max(0, Math.min(1, d.bbox.x / batch.frameWidth));
            const fy = Math.max(0, Math.min(1, d.bbox.y / batch.frameHeight));
            const fw = Math.max(
              0,
              Math.min(1 - fx, d.bbox.width / batch.frameWidth),
            );
            const fh = Math.max(
              0,
              Math.min(1 - fy, d.bbox.height / batch.frameHeight),
            );
            const pct = Math.round(d.confidence * 100);
            const label =
              d.trackId != null
                ? `${d.classLabel} #${d.trackId} ${pct}%`
                : `${d.classLabel} ${pct}%`;
            const clickable = onSelectBox != null;
            return (
              <div
                key={`${batch.frameId}-${i}`}
                className={`absolute border ${boxColorClass(d)} ${
                  clickable
                    ? "pointer-events-auto cursor-pointer hover:border-2"
                    : ""
                }`}
                style={{
                  left: `${rect.left + fx * rect.width}px`,
                  top: `${rect.top + fy * rect.height}px`,
                  width: `${fw * rect.width}px`,
                  height: `${fh * rect.height}px`,
                }}
                onClick={
                  clickable ? () => onSelectBox(d, batch.cameraId) : undefined
                }
                role={clickable ? "button" : undefined}
                title={clickable ? "Click to follow this target" : undefined}
              >
                <span className="absolute left-0 top-0 -translate-y-full whitespace-nowrap bg-bg-primary/80 px-1 font-mono text-[10px] leading-tight">
                  {label}
                </span>
              </div>
            );
          })}
    </div>
  );
}
