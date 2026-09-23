"use client";

/**
 * @module use-vision-pipelines
 * @description Derives the set of vision pipelines RUNNING on a drone right now
 * from the live detection streams. The engine broadcasts one detection batch
 * per (model, camera), so each active stream IS a running pipeline — a model
 * producing detections on a camera. This hook turns the per-stream store
 * (`streamsForDrone`) into a stable, freshness-aware pipeline list the vision
 * hub renders, so an operator sees every pipeline running simultaneously
 * instead of one clobbering the rest.
 *
 * This is derived purely from the detection stream (no extra agent round-trip),
 * so it shows every pipeline that is ACTIVELY PUBLISHING. A registered model
 * that is loaded but idle (publishing nothing) needs the agent's engine
 * read-back to appear — a separate, richer status source layered on later.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";

import {
  DETECTION_STALE_MS,
  streamKey,
  useVisionDetectionsStore,
} from "@/stores/vision-detections-store";

/** One vision pipeline running on the drone (a model × camera stream). */
export interface VisionPipeline {
  /** Stable key (`modelId::cameraId`). */
  key: string;
  modelId: string;
  cameraId: string;
  /** Detections in the latest frame on this stream. */
  detectionCount: number;
  /** How many of those are a confidently-locked track. */
  lockedCount: number;
  /** Whether a batch arrived recently (within `DETECTION_STALE_MS`). */
  active: boolean;
  /** Age of the latest batch in ms. */
  ageMs: number;
  /** Latest frame id seen on this stream. */
  frameId: number;
}

/**
 * The pipelines running on `droneId` now, sorted by key for a stable list.
 * Recomputes on a new batch and on a slow freshness tick so a stream that stops
 * publishing flips to stale without a new batch.
 */
export function useVisionPipelines(droneId: string): VisionPipeline[] {
  const streamsMap = useVisionDetectionsStore((s) => s.streams[droneId]);
  const [now, setNow] = useState(() => Date.now());

  // Keyed on whether any stream exists, not on the streams map that is rebuilt
  // on every batch: at 10-15 Hz that would clear the interval before it fired
  // and freeze `now`, keeping a stopped stream "running" forever.
  const hasStreams = !!streamsMap;
  useEffect(() => {
    if (!hasStreams) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [hasStreams]);

  return useMemo(() => {
    if (!streamsMap) return [];
    return Object.values(streamsMap)
      .map((b) => {
        const ageMs = now - b.receivedAt;
        return {
          key: streamKey(b.modelId, b.cameraId),
          modelId: b.modelId,
          cameraId: b.cameraId,
          detectionCount: b.detections.length,
          lockedCount: b.detections.filter((d) => d.lockState === "locked").length,
          active: ageMs <= DETECTION_STALE_MS,
          ageMs,
          frameId: b.frameId,
        };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [streamsMap, now]);
}
