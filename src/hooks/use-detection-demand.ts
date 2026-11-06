"use client";

/**
 * @module use-detection-demand
 * @description Ask a drone's vision engine to run detection on one camera
 * while a view that draws detection overlays for it is mounted, enabled and
 * the page is visible. The lease is shared with every other view on the same
 * (drone, camera) and released when the last one closes or the page is
 * hidden; see {@link holdDetectionDemand}. Demo mode holds nothing.
 *
 * Returns where the lease stands, or null while no lease is held.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState, useSyncExternalStore } from "react";

import {
  holdDetectionDemand,
  type DetectionDemandStatus,
} from "@/lib/agent/detection-demand";
import { isDemoMode } from "@/lib/utils";

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function useDetectionDemand(
  droneId: string | null,
  cameraId: string | null,
  enabled: boolean,
): DetectionDemandStatus | null {
  const visible = useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState !== "hidden",
    () => false,
  );
  const holding = enabled && visible && !!droneId && !!cameraId && !isDemoMode();
  const [status, setStatus] = useState<DetectionDemandStatus | null>(null);

  useEffect(() => {
    if (!holding || !droneId || !cameraId) return;
    // Reports the lease's current status at once, then every change.
    return holdDetectionDemand(droneId, cameraId, setStatus);
  }, [holding, droneId, cameraId]);

  return holding ? status : null;
}
