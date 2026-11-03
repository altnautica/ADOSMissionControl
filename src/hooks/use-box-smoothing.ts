"use client";

/**
 * @module use-box-smoothing
 * @description Per-track box smoothing for a target overlay. Each tracked
 * detection's latest box becomes an ease target; a requestAnimationFrame loop
 * eases the displayed boxes toward their targets with a 120 ms time constant
 * and stops once every box is within 0.5 px, so the loop idles between
 * detection batches. Untracked detections have no identity to interpolate and
 * draw raw. Reduced motion (or no fresh batch) empties the map.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { advanceBoxes, smoothingAlpha, type SmoothBox } from "@/lib/vision/box-smoothing";
import type { VisionDetectionBatch } from "@/stores/vision-detections-store";

/** ~63 % of the gap to a new box closes in this window. */
export const SMOOTH_TIME_CONSTANT_MS = 120;
/** Below this per-field gap a box snaps to its target. */
export const CONVERGE_EPS_PX = 0.5;

/** Smoothing key for a tracked detection. */
export function smoothKey(cameraId: string, trackId: number): string {
  return `${cameraId}:${trackId}`;
}

/** The displayed (eased) box per `smoothKey`. */
export function useBoxSmoothing(
  batch: VisionDetectionBatch | null,
  reducedMotion: boolean,
): ReadonlyMap<string, SmoothBox> {
  const targetsRef = useRef<Map<string, SmoothBox>>(new Map());
  const [displayed, setDisplayed] = useState<Map<string, SmoothBox>>(() => new Map());
  const displayedRef = useRef<Map<string, SmoothBox>>(displayed);
  const rafRef = useRef(0);

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

  useEffect(() => {
    const targets = targetsRef.current;
    if (reducedMotion || !batch) {
      // One loop pass prunes the displayed boxes to the empty target set.
      targets.clear();
      if (!reducedMotion) startLoop();
      return;
    }
    const seen = new Set<string>();
    for (const d of batch.detections) {
      if (d.trackId == null || !d.bbox) continue;
      const key = smoothKey(batch.cameraId, d.trackId);
      targets.set(key, { x: d.bbox.x, y: d.bbox.y, width: d.bbox.width, height: d.bbox.height });
      seen.add(key);
    }
    for (const key of targets.keys()) {
      if (!seen.has(key)) targets.delete(key);
    }
    startLoop();
  }, [batch, reducedMotion, startLoop]);

  return displayed;
}
