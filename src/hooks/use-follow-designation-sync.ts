"use client";

/**
 * @module use-follow-designation-sync
 * @description Mirrors follow-me's discrete events into the host designation.
 * `follow.reacquired` moves the designation to the re-acquired track (follow-me
 * has already designated it on the agent); `follow.lost` clears it. Each event
 * is applied once; an event already in the store when the hook mounts is not
 * replayed.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";

import { latestForCamera } from "@/hooks/use-detection-batch";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

/**
 * @param droneId the drone whose events to mirror; null disables the hook.
 * @param fallbackCameraId camera to use when neither the designation nor the
 *   follow prediction names one (the camera the video shows).
 */
export function useFollowDesignationSync(droneId: string | null, fallbackCameraId: string | null): void {
  const event = useNavStreamStore((s) => (droneId ? s.byDrone[droneId]?.followEvent : undefined));
  const handledRef = useRef<number | null>(event?.receivedAt ?? null);

  useEffect(() => {
    if (!droneId || !event || handledRef.current === event.receivedAt) return;
    handledRef.current = event.receivedAt;
    const store = useSelectedTargetStore.getState();
    const prev = store.designated && store.designated.droneId === droneId ? store.designated : null;

    if (event.data.topic === "follow.lost") {
      if (prev) store.release();
      return;
    }

    const follow = useNavStreamStore.getState().byDrone[droneId]?.follow?.data;
    const cameraId = prev?.cameraId ?? follow?.predictedBbox?.cameraId ?? fallbackCameraId;
    if (!cameraId) return;
    const trackId = event.data.trackId;
    const batch = latestForCamera(useVisionDetectionsStore.getState().streams[droneId], cameraId);
    const live = batch?.detections.find((d) => d.trackId === trackId && d.bbox);
    if (!live?.bbox && !prev) return;
    store.setDesignated({
      droneId,
      cameraId,
      trackId,
      bbox: live?.bbox ?? prev!.bbox,
      classLabel: live?.classLabel ?? prev?.classLabel ?? "",
      confidence: live?.confidence ?? prev?.confidence ?? 0,
    });
  }, [event, droneId, fallbackCameraId]);
}
