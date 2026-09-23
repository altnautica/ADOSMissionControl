"use client";

/**
 * @module vision/CockpitTargetOverlay
 * @description The HOST-owned detection / target overlay for the cockpit. It
 * draws the live detection boxes of the camera the video shows over the
 * letterbox-corrected video rect, lets the operator CLICK a box to open its
 * target-action popup, and draws lock brackets on the designated target. Unlike
 * a plugin's own `video.overlay` iframe, this is owned by the host, so a single
 * overlay can aggregate actions from every plugin for the clicked target (the
 * popup) and one designation is shared across the app.
 *
 * Boxes are the only interactive elements (`pointer-events-auto`); the wrapper
 * is `pointer-events-none` so the rest of the video pane stays interactive.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { computeRenderedRect } from "@/components/cockpit/VideoOverlayHost";
import { useDisplayedDetectionBatch } from "@/hooks/use-detection-batch";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import type { RenderedRect } from "@/lib/plugins/video-overlay-props";
import {
  advanceBoxes,
  smoothingAlpha,
  type SmoothBox,
} from "@/lib/vision/box-smoothing";
import {
  DETECTION_STALE_MS,
  type DetectionBox,
  type VisionDetection,
} from "@/stores/vision-detections-store";
import {
  isSameTrack,
  useSelectedTargetStore,
  type SelectedTarget,
} from "@/stores/selected-target-store";
import { TargetActionPopup } from "./TargetActionPopup";

const STALE_MS = DETECTION_STALE_MS;

/** Smoothing time-constant: ~63% of the gap to a new box closes in this window,
 * so a box glides to its latest position in a few frames rather than jumping. */
const SMOOTH_TIME_CONSTANT_MS = 120;

/** Below this per-field pixel gap a box is treated as converged and snapped to
 * its target, so the animation loop can idle until the next detection batch. */
const CONVERGE_EPS_PX = 0.5;

/**
 * Box class from selection + tracker lock-state + confidence:
 *  - designated target → `det lock` (green + corner brackets + pulse);
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

/** Whether a detection from `cameraId` is the designated target: (camera,
 * track) for a tracked target, the exact box on the same camera otherwise. */
function isDesignated(
  d: BoxedDetection,
  cameraId: string,
  designated: SelectedTarget | null,
): boolean {
  if (!designated || designated.cameraId !== cameraId) return false;
  if (designated.trackId != null) return isSameTrack(designated, cameraId, d.trackId);
  return (
    d.trackId == null &&
    d.bbox.x === designated.bbox.x &&
    d.bbox.y === designated.bbox.y &&
    d.bbox.width === designated.bbox.width
  );
}

export function CockpitTargetOverlay({ droneId }: { droneId: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const batch = useDisplayedDetectionBatch(droneId);
  const popupTarget = useSelectedTargetStore((s) => s.popupTarget);
  const designated = useSelectedTargetStore((s) => s.designated);
  const openPopup = useSelectedTargetStore((s) => s.openPopup);
  const closePopup = useSelectedTargetStore((s) => s.closePopup);
  const reset = useSelectedTargetStore((s) => s.reset);
  const reducedMotion = usePrefersReducedMotion();

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // ── Per-track box smoothing ──
  // `targetsRef` holds the latest detected box per track id; `displayed` (state,
  // so render stays pure) the on-screen box easing toward it. A rAF loop eases
  // every displayed box toward its target and publishes a new snapshot until each
  // has converged, then stops; the next batch restarts it. Smoothing is keyed on `track_id` (a stable identity);
  // untracked detections render raw (no identity to interpolate). Reduced motion
  // snaps to raw (loop idle).
  const targetsRef = useRef<Map<string, SmoothBox>>(new Map());
  const [displayed, setDisplayed] = useState<Map<string, SmoothBox>>(
    () => new Map(),
  );
  const displayedRef = useRef<Map<string, SmoothBox>>(displayed);
  /** The pending animation frame; 0 while the loop is idle. */
  const rafRef = useRef(0);

  // Run the easing loop until every box has settled on its target, then stop.
  // Each step eases with frame-rate-independent critically-damped smoothing,
  // prunes boxes whose track left the batch and publishes a snapshot only when
  // something moved.
  const startLoop = useCallback(() => {
    if (rafRef.current !== 0) return;
    let lastTs: number | null = null;
    const step = (t: number) => {
      const alpha = smoothingAlpha(t - (lastTs ?? t), SMOOTH_TIME_CONSTANT_MS);
      lastTs = t;
      const { next, settled } = advanceBoxes(
        displayedRef.current,
        targetsRef.current,
        alpha,
        CONVERGE_EPS_PX,
      );
      if (next !== displayedRef.current) {
        displayedRef.current = next;
        setDisplayed(next);
      }
      rafRef.current = settled ? 0 : requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    },
    [],
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

  // Drop both the popup and the designation on drone switch / unmount so B
  // never shows A's popup or lock.
  useEffect(() => {
    return () => reset();
  }, [droneId, reset]);

  const popupHere =
    popupTarget && popupTarget.droneId === droneId ? popupTarget : null;

  // Escape + outside-click dismiss the popup (the designation stays).
  useEffect(() => {
    if (!popupHere) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        closePopup();
      }
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest("[data-target-interactive]")) return;
      closePopup();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [popupHere, closePopup]);

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

  // The popup's actions act on the pixels it was opened on. Once that camera's
  // feed is no longer the fresh, displayed one, close it: the same gate that
  // hides the boxes.
  const popupLive = !!popupHere && !!fresh && popupHere.cameraId === batch?.cameraId;
  useEffect(() => {
    if (popupHere && !popupLive) closePopup();
  }, [popupHere, popupLive, closePopup]);

  // Sync the per-track smoothing targets to the current fresh batch: each
  // tracked detection's box becomes the ease target; a track that leaves the
  // fresh set is dropped (respecting the STALE_MS gate — no invented boxes for
  // a dead feed). Reduced motion / stale keeps the target set empty.
  useEffect(() => {
    const targets = targetsRef.current;
    if (reducedMotion || !fresh || !batch) {
      // Empty the targets; one loop pass prunes the displayed boxes to match.
      // While reduced motion is on the render ignores the displayed map (it
      // draws raw boxes), so no pass is needed.
      targets.clear();
      if (!reducedMotion) startLoop();
      return;
    }
    const seen = new Set<string>();
    for (const d of batch.detections) {
      if (d.trackId == null || !d.bbox) continue;
      const key = `${batch.cameraId}:${d.trackId}`;
      targets.set(key, {
        x: d.bbox.x,
        y: d.bbox.y,
        width: d.bbox.width,
        height: d.bbox.height,
      });
      seen.add(key);
    }
    for (const key of targets.keys()) {
      if (!seen.has(key)) targets.delete(key);
    }
    startLoop();
  }, [batch, fresh, reducedMotion, startLoop]);

  /** The box to POSITION a detection at: the smoothed box for a tracked
   * detection, else the raw box (untracked, or reduced motion). Selection and
   * labels always use the detection's own raw box; only placement is smoothed. */
  const displayBoxOf = (d: BoxedDetection): DetectionBox => {
    if (reducedMotion || d.trackId == null || !batch) return d.bbox;
    return displayed.get(`${batch.cameraId}:${d.trackId}`) ?? d.bbox;
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

  const designatedHere =
    designated && designated.droneId === droneId ? designated : null;

  // Keyed by track so a box keeps its DOM node across detection batches
  // (10-15 Hz). A per-frame key replaced the node between mousedown and
  // mouseup, and the browser then fires no click. An untracked box, or a
  // repeat of a track id within one batch, falls back to its camera + index.
  const seenTracks = new Set<number>();
  const boxKey = (d: BoxedDetection, i: number): string => {
    if (d.trackId == null || seenTracks.has(d.trackId)) return `i:${batch?.cameraId}:${i}`;
    seenTracks.add(d.trackId);
    return `t:${d.trackId}`;
  };

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
          const sel = isDesignated(d, batch.cameraId, designatedHere);
          const cls = boxClass(d, sel);
          const label = `${d.classLabel} ${Math.round(d.confidence * 100)}%`;
          return (
            <button
              key={boxKey(d, i)}
              type="button"
              data-target-interactive
              onClick={() =>
                openPopup({
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

      {/* The action popup, anchored just under the clicked box. */}
      {popupHere &&
        popupLive &&
        rect &&
        (() => {
          const p = place(popupHere.bbox);
          if (!p) return null;
          return (
            <div
              className="absolute z-[7]"
              style={{ left: `${p.left}px`, top: `${p.top + p.height + 4}px` }}
            >
              <TargetActionPopup target={popupHere} onClose={closePopup} />
            </div>
          );
        })()}
    </div>
  );
}
