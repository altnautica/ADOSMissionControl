"use client";

/**
 * @module use-target-popup
 * @description The target-action popup slot for one video surface. A popup
 * belongs to the surface showing its camera. It is shown while that camera's
 * feed is fresh and the video is live, closes as soon as it is not, and is
 * dismissed by Escape or a click outside any target control. The main video
 * also closes a popup whose camera no surface shows any more.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";

import { useSelectedTargetStore, type SelectedTarget } from "@/stores/selected-target-store";

export interface TargetPopupInput {
  droneId: string;
  /** The camera this surface shows. */
  camera: string | null;
  /** This surface's camera has a fresh batch and live video. */
  live: boolean;
  /** Cameras some other surface shows (main video only; null for the PiP). */
  otherCameras: readonly (string | null | undefined)[] | null;
}

/** @returns the popup target to draw on this surface, or null. */
export function useTargetPopup(i: TargetPopupInput): SelectedTarget | null {
  const popupTarget = useSelectedTargetStore((s) => s.popupTarget);
  const closePopup = useSelectedTargetStore((s) => s.closePopup);

  const here = popupTarget && popupTarget.droneId === i.droneId ? popupTarget : null;
  const mine = here !== null && here.cameraId === i.camera;
  const shown = mine && i.live;
  const orphan =
    here !== null && !mine && i.otherCameras !== null && !i.otherCameras.includes(here.cameraId);

  useEffect(() => {
    if ((mine && !shown) || orphan) closePopup();
  }, [mine, shown, orphan, closePopup]);

  useEffect(() => {
    if (!shown) return;
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
  }, [shown, closePopup]);

  return shown ? here : null;
}
