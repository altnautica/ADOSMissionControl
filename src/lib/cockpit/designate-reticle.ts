/**
 * @module cockpit/designate-reticle
 * @description The controller's designate reticle (cockpit spec `ds4.json`
 * `designate.default`): the touchpad opens a reticle at the centre of the
 * video, the D-pad moves it, Cross selects what is under it and Circle
 * cancels. While it is open the dispatcher hands those controls here instead
 * of to their bindings. The point is in normalised video coordinates (0..1);
 * the target layer turns it into a box and designates it.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import type { DetectionBox } from "@/stores/vision-detections-store";

/** One D-pad press moves the reticle this far (a fraction of the frame). */
export const RETICLE_STEP = 0.05;

export type ReticleSelect = (x: number, y: number) => void;

interface ReticleState {
  open: boolean;
  x: number;
  y: number;
  /** Set by the mounted target layer; null while no video layer can take it. */
  onSelect: ReticleSelect | null;
}

export const useDesignateReticle = create<ReticleState>(() => ({
  open: false,
  x: 0.5,
  y: 0.5,
  onSelect: null,
}));

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function toggleReticle(): void {
  const s = useDesignateReticle.getState();
  useDesignateReticle.setState(s.open ? { open: false } : { open: true, x: 0.5, y: 0.5 });
}

export function setReticleSelect(fn: ReticleSelect | null): void {
  useDesignateReticle.setState({ onSelect: fn });
}

/**
 * Route one controller press while the reticle is open. Returns true when
 * the reticle consumed it (D-pad, Cross, Circle), so its binding must not run.
 */
export function reticleControl(control: string): boolean {
  const s = useDesignateReticle.getState();
  if (!s.open) return false;
  switch (control) {
    case "dpad_up":
      useDesignateReticle.setState({ y: clamp(s.y - RETICLE_STEP) });
      return true;
    case "dpad_down":
      useDesignateReticle.setState({ y: clamp(s.y + RETICLE_STEP) });
      return true;
    case "dpad_left":
      useDesignateReticle.setState({ x: clamp(s.x - RETICLE_STEP) });
      return true;
    case "dpad_right":
      useDesignateReticle.setState({ x: clamp(s.x + RETICLE_STEP) });
      return true;
    case "cross":
      useDesignateReticle.setState({ open: false });
      s.onSelect?.(s.x, s.y);
      return true;
    case "circle":
      useDesignateReticle.setState({ open: false });
      return true;
    default:
      return false;
  }
}

/** Side of the box designated when no detection is under the reticle, as a
 * fraction of the frame's shorter side. */
export const RETICLE_BOX_FRACTION = 0.1;

/**
 * The box to designate for a reticle at normalised (`x`, `y`): the smallest
 * detection containing the point, else a square around it, in frame pixels.
 */
export function reticleBox(
  x: number,
  y: number,
  frameW: number,
  frameH: number,
  boxes: readonly DetectionBox[],
): DetectionBox {
  const px = x * frameW;
  const py = y * frameH;
  let best: DetectionBox | null = null;
  for (const b of boxes) {
    if (px < b.x || px > b.x + b.width || py < b.y || py > b.y + b.height) continue;
    if (!best || b.width * b.height < best.width * best.height) best = b;
  }
  if (best) return best;
  const side = Math.min(frameW, frameH) * RETICLE_BOX_FRACTION;
  return {
    x: Math.max(0, Math.min(frameW - side, px - side / 2)),
    y: Math.max(0, Math.min(frameH - side, py - side / 2)),
    width: side,
    height: side,
  };
}
