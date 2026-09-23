"use client";

/**
 * @module use-detection-batch
 * @description Per-camera views of a drone's detection streams. The engine
 * publishes one batch per (model, camera) and runs a separate tracker per
 * camera, so track ids repeat across cameras and the latest batch across every
 * stream alternates between cameras. Anything drawn over the video must use
 * the batch of the camera the video shows; anything about a designated target
 * must use the batch of that target's camera.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";

import { pickActiveLegBatch } from "@/components/cockpit/VideoOverlayHost";
import {
  useVisionDetectionsStore,
  type VisionDetectionBatch,
} from "@/stores/vision-detections-store";
import { useVideoStreamsStore } from "@/stores/video-streams-store";

/** The newest batch from `cameraId` across the drone's per-model streams. */
export function latestForCamera(
  perStream: Record<string, VisionDetectionBatch> | undefined,
  cameraId: string | null,
): VisionDetectionBatch | undefined {
  if (!perStream || cameraId == null) return undefined;
  let best: VisionDetectionBatch | undefined;
  for (const b of Object.values(perStream)) {
    if (b.cameraId === cameraId && (best == null || b.receivedAt > best.receivedAt)) {
      best = b;
    }
  }
  return best;
}

/**
 * The batch whose boxes belong on the displayed video. A node with several
 * video legs uses the active leg's camera. A node with one video leg uses the
 * only detecting camera; when several cameras detect behind one leg, it uses
 * the camera matching the leg id and draws nothing when none matches, so
 * another camera's boxes are never painted over this video.
 */
export function pickDisplayedBatch(
  multiLeg: boolean,
  latest: VisionDetectionBatch | undefined,
  perStream: Record<string, VisionDetectionBatch> | undefined,
  activeLegId: string | null,
): VisionDetectionBatch | undefined {
  if (multiLeg) return pickActiveLegBatch(true, latest, perStream, activeLegId);
  const cameras = new Set(Object.values(perStream ?? {}).map((b) => b.cameraId));
  if (cameras.size <= 1) return latest;
  return latestForCamera(perStream, activeLegId);
}

/** The detection batch for the camera the cockpit video shows. */
export function useDisplayedDetectionBatch(
  droneId: string,
): VisionDetectionBatch | undefined {
  const latest = useVisionDetectionsStore((s) => s.batches[droneId]);
  const perStream = useVisionDetectionsStore((s) => s.streams[droneId]);
  const legs = useVideoStreamsStore((s) => s.streamsByDrone[droneId]);
  const activeStreamId = useVideoStreamsStore((s) => s.activeStreamIdByDrone[droneId]);
  const multiLeg = (legs?.length ?? 0) > 1;
  const activeLegId = activeStreamId ?? legs?.[0]?.id ?? null;
  return useMemo(
    () => pickDisplayedBatch(multiLeg, latest, perStream, activeLegId),
    [multiLeg, latest, perStream, activeLegId],
  );
}

/** The newest detection batch from one camera of a drone. */
export function useCameraDetectionBatch(
  droneId: string,
  cameraId: string | null,
): VisionDetectionBatch | undefined {
  const perStream = useVisionDetectionsStore((s) => s.streams[droneId]);
  return useMemo(() => latestForCamera(perStream, cameraId), [perStream, cameraId]);
}
