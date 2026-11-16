/**
 * @module crop-hold
 * @description While following, the vision engine detects most frames only
 * inside a crop around the subject and sets `cropWindow` on those batches.
 * Boxes outside the window are not re-detected then, so they would blink at
 * the whole-frame rate. A crop-only batch therefore keeps the latest
 * whole-frame batch's boxes whose centre lies outside the window, minus the
 * track ids the new batch carries. Held boxes end at the next whole-frame
 * batch, or once their batch is older than {@link CROP_HOLD_MS}. A batch
 * without `cropWindow` is drawn as it is.
 *
 * @license GPL-3.0-only
 */

import type { DetectionBox, VisionDetection } from "@/stores/vision-detections-store";

/** How long a whole-frame batch's boxes are held, ms of frame time. */
export const CROP_HOLD_MS = 1000;

/** A stream's latest whole-frame boxes, kept for crop-only batches. */
export interface WholeFrame {
  tsMs: number;
  detections: VisionDetection[];
}

/** The batch fields the hold reads. */
interface Frame {
  tsMs: number;
  detections: VisionDetection[];
  cropWindow?: DetectionBox;
  wholeFrame?: WholeFrame;
}

function centreInside(b: DetectionBox, w: DetectionBox): boolean {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  return cx >= w.x && cx <= w.x + w.width && cy >= w.y && cy <= w.y + w.height;
}

/**
 * `next`'s detections with the held whole-frame boxes added (marked
 * `held`), and the whole frame the stream keeps, given the stream's
 * `previous` batch. `seed` is a whole frame that came with `next` (a
 * polled reply's `full_frame`, for a poller that misses most whole-frame
 * batches); the newer of it and the stream's own is held.
 */
export function holdOutsideCrop(
  previous: Frame | undefined,
  next: Frame,
  seed?: WholeFrame,
): { detections: VisionDetection[]; wholeFrame?: WholeFrame } {
  if (!next.cropWindow) {
    return { detections: next.detections, wholeFrame: { tsMs: next.tsMs, detections: next.detections } };
  }
  const own = previous?.wholeFrame;
  const whole = seed && (!own || seed.tsMs > own.tsMs) ? seed : own;
  const age = whole ? next.tsMs - whole.tsMs : Infinity;
  if (!whole || age < 0 || age > CROP_HOLD_MS) {
    return { detections: next.detections, wholeFrame: whole };
  }
  const win = next.cropWindow;
  const ids = new Set(next.detections.flatMap((d) => (d.trackId != null ? [d.trackId] : [])));
  const held = whole.detections.flatMap((d) =>
    d.bbox && !centreInside(d.bbox, win) && !(d.trackId != null && ids.has(d.trackId))
      ? [{ ...d, held: true }]
      : [],
  );
  return { detections: [...next.detections, ...held], wholeFrame: whole };
}
