"use client";

/**
 * @module DetectionOverlay
 * @description The read-only HUD target layer for video previews outside the
 * cockpit (node-detail Perception tab, mini video views, source config
 * previews). It resolves one camera's detection batch, the designated target
 * and the follow-me state through the same resolver and {@link TargetGlyph}
 * as the cockpit, so a target looks the same on every surface.
 *
 * Boxes are mapped from the batch's frame size onto the rect the video
 * actually paints into (the `object-contain` letterbox by default, the
 * `object-cover` crop with `fit="cover"`), never onto the whole pane.
 * Stale batches age out after `staleAfterMs` so a stopped feed does not pin
 * the last frame's boxes.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useRef } from "react";

import { computeRenderedRect } from "@/components/cockpit/VideoOverlayHost";
import { useDisplayedDetectionBatch } from "@/hooks/use-detection-batch";
import { useElementSize } from "@/hooks/use-element-size";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { useResolvedTargets } from "@/hooks/use-resolved-targets";
import { widthClassFor } from "@/lib/cockpit/width-class";
import { coverRect } from "@/lib/vision/target-geometry";
import { layoutTargets, tagFontPx } from "@/lib/vision/target-layout";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import {
  DETECTION_STALE_MS,
  useVisionDetectionsStore,
} from "@/stores/vision-detections-store";

import { TargetGlyph } from "./TargetGlyph";

interface DetectionOverlayProps {
  /** Drone/device id whose detection batch this overlay renders. */
  droneId: string;
  /**
   * Pin the overlay to one pipeline stream (`modelId::cameraId`). When set, the
   * overlay renders that specific model×camera stream instead of the batch of
   * the displayed camera, so a multi-camera node can preview one pipeline
   * without the others clobbering it. Absent = the batch of the camera the
   * active video stream shows (never another camera's boxes; nothing when that
   * camera has no batch).
   */
  streamKey?: string;
  /** Drop boxes older than this (ms). Default: the detection stale window. */
  staleAfterMs?: number;
  /** How the video fills the pane. Default `contain`. */
  fit?: "contain" | "cover";
  className?: string;
}

export function DetectionOverlay({
  droneId,
  streamKey,
  staleAfterMs = DETECTION_STALE_MS,
  fit = "contain",
  className,
}: DetectionOverlayProps) {
  const pinned = useVisionDetectionsStore((s) =>
    streamKey ? s.streams[droneId]?.[streamKey] : undefined,
  );
  const displayed = useDisplayedDetectionBatch(droneId);
  const legs = useVideoStreamsStore((s) => s.streamsByDrone[droneId]);
  const activeStreamId = useVideoStreamsStore((s) => s.activeStreamIdByDrone[droneId]);
  const batch = streamKey ? pinned : displayed;
  const leg = activeStreamId ?? legs?.[0]?.id ?? null;
  const role = legs?.find((l) => l.id === (batch?.cameraId ?? leg))?.role;

  const { resolved, now } = useResolvedTargets({
    droneId,
    batch,
    cameraId: batch?.cameraId ?? leg,
    videoLost: false,
    cameraYawOffsetDeg: role === "down" ? null : 0,
  });
  // A caller-specific stale window tighter than the shared one.
  const tooOld = !batch || now - batch.receivedAt > staleAfterMs;

  const wrapperRef = useRef<HTMLDivElement>(null);
  const size = useElementSize(wrapperRef);
  const reducedMotion = usePrefersReducedMotion();
  const { frameW, frameH } = resolved;

  const layouts = useMemo(() => {
    if (!size || frameW <= 0 || frameH <= 0) return [];
    const widthClass = widthClassFor(size.w, false);
    return layoutTargets(resolved, {
      rendered:
        fit === "cover"
          ? coverRect(size.w, size.h, frameW, frameH)
          : computeRenderedRect(size.w, size.h, frameW, frameH),
      fontPx: tagFontPx(widthClass, false),
      widthClass,
    });
  }, [resolved, size, frameW, frameH, fit]);

  // The wrapper always renders: it is what the size observer measures, so the
  // first batch after a quiet period paints in the right place.
  return (
    <div ref={wrapperRef} className={`tgt-layer ${className ?? ""}`} aria-hidden>
      {(tooOld ? layouts.filter((l) => !l.item.detection) : layouts).map((l) => (
        <TargetGlyph key={l.key} layout={l} reducedMotion={reducedMotion} />
      ))}
    </div>
  );
}
