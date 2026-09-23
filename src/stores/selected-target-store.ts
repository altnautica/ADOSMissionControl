/**
 * @module selected-target-store
 * @description The host-owned cockpit target state. Two separate slots:
 *
 *  - `popupTarget`: the detection the operator clicked, whose target-action
 *    popup is open. Dismissable (Escape, outside click, running an action, a
 *    stale feed). Hotkeys and the popup act on it.
 *  - `designated`: the target the vision engine acknowledged as designated.
 *    Set only on the engine's acknowledgement of a designate; it survives the
 *    popup closing and stays until the operator releases it or designates
 *    another target. The lock chip, the lock brackets and the lead reticle read
 *    it, and report "Lost" / "Not in view" while the tracker cannot see it.
 *
 * Ephemeral UI state (not persisted). Both clear on drone switch.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import type { DetectionBox } from "@/stores/vision-detections-store";

export interface SelectedTarget {
  /** The node id (`node:<deviceId>`) whose overlay the target was clicked in. */
  droneId: string;
  /** The camera the detection came from. */
  cameraId: string;
  /** The tracker's stable id for this subject, or null for an untracked box. */
  trackId: number | null;
  /** The box in SOURCE-FRAME pixels (the detection's own coordinate space). */
  bbox: DetectionBox;
  classLabel: string;
  confidence: number;
}

interface SelectedTargetState {
  popupTarget: SelectedTarget | null;
  designated: SelectedTarget | null;
  openPopup: (target: SelectedTarget) => void;
  closePopup: () => void;
  setDesignated: (target: SelectedTarget) => void;
  release: () => void;
  /** Drop both slots (drone switch / overlay unmount). */
  reset: () => void;
}

export const useSelectedTargetStore = create<SelectedTargetState>()((set) => ({
  popupTarget: null,
  designated: null,
  openPopup: (target) => set({ popupTarget: target }),
  closePopup: () => set({ popupTarget: null }),
  setDesignated: (target) => set({ designated: target }),
  release: () => set({ designated: null }),
  reset: () => set({ popupTarget: null, designated: null }),
}));

/** Whether a detection on `cameraId` with `trackId` is the given target. A
 * tracked target matches on (camera, track) because track ids repeat across
 * cameras; an untracked one never matches a later frame by id. */
export function isSameTrack(
  target: Pick<SelectedTarget, "cameraId" | "trackId"> | null,
  cameraId: string,
  trackId: number | null | undefined,
): boolean {
  return (
    target != null &&
    target.trackId != null &&
    trackId != null &&
    target.cameraId === cameraId &&
    target.trackId === trackId
  );
}
