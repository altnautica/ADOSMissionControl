"use client";

/**
 * @module vision/CockpitTargetOverlay
 * @description The HOST-owned detection / target overlay for the cockpit. It
 * draws the live detection boxes over the letterbox-corrected video rect
 * (reading the shared vision-detections store), lets the operator CLICK a box to
 * select it, highlights the selection, and anchors the target-action popup to
 * it. Unlike a plugin's own `video.overlay` iframe, this is owned by the host,
 * so a single overlay can aggregate actions from every plugin for the clicked
 * target (the popup) and one selection is shared across the app.
 *
 * Boxes are the only interactive elements (`pointer-events-auto`); the wrapper
 * is `pointer-events-none` so the rest of the video pane stays interactive.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";

import { computeRenderedRect } from "@/components/cockpit/VideoOverlayHost";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import type { RenderedRect } from "@/lib/plugins/video-overlay-props";
import {
  boxDistance,
  easeBox,
  smoothingAlpha,
  type SmoothBox,
} from "@/lib/vision/box-smoothing";
import {
  DETECTION_STALE_MS,
  useVisionDetectionsStore,
  type DetectionBox,
  type VisionDetection,
} from "@/stores/vision-detections-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import { TargetActionPopup } from "./TargetActionPopup";

const STALE_MS = DETECTION_STALE_MS;

/** Smoothing time-constant: ~63% of the gap to a new box closes in this window,
 * so a box glides to its latest position in a few frames rather than jumping. */
const SMOOTH_TIME_CONSTANT_MS = 120;

/** Below this per-field pixel gap a box is treated as converged and snapped to
 * its target, so the animation loop can idle until the next detection batch. */
const CONVERGE_EPS_PX = 0.5;

/**
 * Artifact box class from selection + tracker lock-state + confidence:
 *  - designated (selected) target → `det lock` (green + corner brackets + pulse);
 *  - a lost track or a low-confidence candidate → `det dim` (dashed, faint);
 *  - everything else → `det` (solid electric-blue).
 */
function boxClass(d: VisionDetection, sel: boolean): string {
  if (sel) return "det lock";
  const dim =
    d.lockState === "lost" || (d.trackId == null && d.confidence < 0.45);
  return dim ? "det dim" : "det";
}

/** A detection that carries a 2D box (the ones this overlay draws + selects). A
 * box-less percept (a mask/pose/depth-only reading) has no box to render here. */
type BoxedDetection = VisionDetection & { bbox: DetectionBox };

/** Whether a detection is the currently-selected target. */
function isSelected(
  d: BoxedDetection,
  selected: { trackId: number | null; bbox: DetectionBox } | null,
): boolean {
  if (!selected) return false;
  if (selected.trackId != null && d.trackId != null)
    return d.trackId === selected.trackId;
  if (selected.trackId == null && d.trackId == null)
    return (
      d.bbox.x === selected.bbox.x &&
      d.bbox.y === selected.bbox.y &&
      d.bbox.width === selected.bbox.width
    );
  return false;
}

export function CockpitTargetOverlay({ droneId }: { droneId: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const batch = useVisionDetectionsStore((s) => s.batches[droneId]);
  const selected = useSelectedTargetStore((s) => s.selected);
  const select = useSelectedTargetStore((s) => s.select);
  const clear = useSelectedTargetStore((s) => s.clear);
  const reducedMotion = usePrefersReducedMotion();

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // ── Per-track box smoothing ──
  // `targetsRef` holds the latest detected box per track id; `displayed` (state,
  // so render stays pure) the on-screen box easing toward it. A rAF loop eases
  // every displayed box toward its target and publishes a new snapshot until each
  // has converged. Smoothing is keyed on `track_id` (a stable identity);
  // untracked detections render raw (no identity to interpolate). Reduced motion
  // snaps to raw (loop idle).
  const targetsRef = useRef<Map<number, SmoothBox>>(new Map());
  const [displayed, setDisplayed] = useState<Map<number, SmoothBox>>(
    () => new Map(),
  );

  // Staleness clock — drop boxes once the feed stops even with no new batch.
  // Key on whether a feed EXISTS, not the batch object (replaced every frame,
  // ~10-15 Hz), so the 500 ms interval is created once per feed lifecycle
  // instead of torn down + recreated on every batch.
  const hasFeed = !!batch;
  useEffect(() => {
    if (!hasFeed) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [hasFeed]);

  // Track the overlay's own size. Boxes are letterbox-mapped from the detection
  // FRAME (batch.frameWidth × frameHeight) into this container, which shares the
  // video's aspect (the frame is downscaled from it) — so the overlay works with
  // or without a live <video> element (e.g. demo, or a not-yet-flowing stream).
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const measure = () => setSize({ w: wrapper.clientWidth, h: wrapper.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  const rect: RenderedRect | null =
    size &&
    batch &&
    batch.frameWidth > 0 &&
    batch.frameHeight > 0 &&
    size.w > 0 &&
    size.h > 0
      ? computeRenderedRect(size.w, size.h, batch.frameWidth, batch.frameHeight)
      : null;

  // Clear the selection on drone switch / unmount so B never shows A's popup.
  useEffect(() => {
    return () => clear();
  }, [droneId, clear]);

  // Escape + outside-click dismiss the popup.
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        clear();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("[data-target-interactive]")) return;
      clear();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [selected, clear]);

  const fresh =
    batch &&
    now - batch.receivedAt <= STALE_MS &&
    batch.frameWidth > 0 &&
    batch.frameHeight > 0;
  // Only boxed detections are drawn + selectable here; a box-less percept
  // (a mask/pose/depth-only reading) has no box to render (a later surface).
  const detections: BoxedDetection[] = fresh
    ? batch.detections.filter((d): d is BoxedDetection => d.bbox != null)
    : [];

  // Sync the per-track smoothing targets to the current fresh batch: each
  // tracked detection's box becomes the ease target; a track that leaves the
  // fresh set is dropped (respecting the STALE_MS gate — no invented boxes for
  // a dead feed). Reduced motion / stale keeps the target set empty.
  useEffect(() => {
    const targets = targetsRef.current;
    if (reducedMotion || !fresh || !batch) {
      // Empty the targets; the rAF loop prunes the displayed boxes to match
      // within a frame. While reduced motion is on the render ignores the
      // displayed map (it draws raw boxes), so no synchronous clear is needed.
      targets.clear();
      return;
    }
    const seen = new Set<number>();
    for (const d of batch.detections) {
      if (d.trackId == null || !d.bbox) continue;
      targets.set(d.trackId, {
        x: d.bbox.x,
        y: d.bbox.y,
        width: d.bbox.width,
        height: d.bbox.height,
      });
      seen.add(d.trackId);
    }
    for (const trackId of targets.keys()) {
      if (!seen.has(trackId)) targets.delete(trackId);
    }
  }, [batch, fresh, reducedMotion]);

  // Animation loop: each frame ease every displayed box toward its target with
  // frame-rate-independent critically-damped smoothing, prune boxes whose track
  // left the batch, and publish the new snapshot. The functional updater returns
  // the SAME map when nothing moved, so React bails out and the loop idles once
  // converged. Skipped entirely under reduced motion. Cleaned up on unmount.
  useEffect(() => {
    if (reducedMotion) return;
    let raf = 0;
    let lastTs: number | null = null;
    const step = (t: number) => {
      const alpha = smoothingAlpha(t - (lastTs ?? t), SMOOTH_TIME_CONSTANT_MS);
      lastTs = t;
      setDisplayed((prev) => {
        const targets = targetsRef.current;
        const next = new Map(prev);
        let changed = false;
        for (const [trackId, target] of targets) {
          const cur = next.get(trackId);
          if (!cur) {
            // A newly-tracked box appears instantly at its detected position.
            next.set(trackId, { ...target });
            changed = true;
            continue;
          }
          const eased = easeBox(cur, target, alpha);
          if (boxDistance(eased, target) <= CONVERGE_EPS_PX) {
            if (boxDistance(cur, target) > 0) {
              next.set(trackId, { ...target });
              changed = true;
            }
          } else {
            next.set(trackId, eased);
            changed = true;
          }
        }
        for (const trackId of next.keys()) {
          if (!targets.has(trackId)) {
            next.delete(trackId);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  /** The box to POSITION a detection at: the smoothed box for a tracked
   * detection, else the raw box (untracked, or reduced motion). Selection and
   * labels always use the detection's own raw box; only placement is smoothed. */
  const displayBoxOf = (d: BoxedDetection): DetectionBox => {
    if (reducedMotion || d.trackId == null) return d.bbox;
    return displayed.get(d.trackId) ?? d.bbox;
  };

  const place = (bbox: DetectionBox) => {
    if (!rect || !batch) return null;
    const sx = rect.width / batch.frameWidth;
    const sy = rect.height / batch.frameHeight;
    return {
      left: rect.left + bbox.x * sx,
      top: rect.top + bbox.y * sy,
      width: bbox.width * sx,
      height: bbox.height * sy,
    };
  };

  const selectedHere = selected && selected.droneId === droneId ? selected : null;

  return (
    <div
      ref={wrapperRef}
      // Host-owned interactive layer (click targets) sits ABOVE the passive
      // plugin `video.overlay` slot (VideoOverlayHost, z-10), so a sandboxed
      // plugin iframe can never occlude the operator's click targets.
      className="pointer-events-none absolute inset-0 z-[12]"
      data-cockpit-layer="target-overlay"
    >
      {rect &&
        batch &&
        detections.map((d, i) => {
          const p = place(displayBoxOf(d));
          if (!p) return null;
          const sel = isSelected(d, selectedHere);
          const cls = boxClass(d, sel);
          const label = `${d.classLabel} ${Math.round(d.confidence * 100)}%`;
          return (
            <button
              key={`${batch.frameId}-${i}`}
              type="button"
              data-target-interactive
              onClick={() =>
                select({
                  droneId,
                  cameraId: batch.cameraId,
                  trackId: d.trackId ?? null,
                  bbox: d.bbox,
                  classLabel: d.classLabel,
                  confidence: d.confidence,
                })
              }
              className={`${cls} pointer-events-auto`}
              style={{
                left: `${p.left}px`,
                top: `${p.top}px`,
                width: `${p.width}px`,
                height: `${p.height}px`,
                background: "transparent",
                padding: 0,
                cursor: "pointer",
                boxSizing: "border-box",
              }}
              title={label}
            >
              {sel ? (
                <>
                  <span className="corner a" />
                  <span className="corner b" />
                  <span className="corner c" />
                  <span className="corner d" />
                </>
              ) : (
                <span className="cls">{label}</span>
              )}
            </button>
          );
        })}

      {/* The action popup, anchored just under the selected box. */}
      {selectedHere &&
        rect &&
        (() => {
          const p = place(selectedHere.bbox);
          if (!p) return null;
          return (
            <div
              className="absolute z-[7]"
              style={{ left: `${p.left}px`, top: `${p.top + p.height + 4}px` }}
            >
              <TargetActionPopup target={selectedHere} onClose={clear} />
            </div>
          );
        })()}
    </div>
  );
}
