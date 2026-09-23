"use client";

/**
 * @module vision/TargetLeadReticle
 * @description Draws a LEAD reticle for the operator-designated target: a ghost
 * reticle a fixed time ahead of a MOVING, tracked target plus the lead vector
 * from its current centre. It reads the target's real per-frame motion from the
 * detection stream and projects it forward — an aim-ahead cue for a mover, and
 * the same lead a gimbal/behaviour would use.
 *
 * It composites through the shared mark layer (pushes marks into
 * `cockpit-marks-store` under one source id; {@link CockpitMarkLayer} draws
 * them letterbox-correct) rather than stacking its own overlay.
 *
 * Honest (no fabricated reading): the reticle appears only for a tracked, designated target
 * on a FRESH feed of the displayed camera with real, measurable motion. It
 * clears the moment the target is released, the track drops, the feed goes
 * stale (a timer fires at the batch's stale deadline even when no further batch
 * arrives), or the target stops — never a fabricated heading for a still or
 * lost target. Renders nothing itself.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";

import { useDisplayedDetectionBatch } from "@/hooks/use-detection-batch";
import type { CockpitMark } from "@/lib/cockpit/marks";
import {
  LEAD_HISTORY_MS,
  LEAD_MS,
  MIN_LEAD_SPEED_PX_PER_SEC,
  computeLead,
  pushLeadSample,
  type TrackSample,
} from "@/lib/vision/target-lead";
import { DETECTION_STALE_MS } from "@/stores/vision-detections-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import { useCockpitMarksStore } from "@/stores/cockpit-marks-store";

/** Stable mark-source id (one owner of the lead marks). */
const SOURCE = "builtin.target-lead";
/** Amber "aim ahead", deliberately distinct from the green designated-lock box. */
const LEAD_COLOR = "#f5b544";

export function TargetLeadReticle({ droneId }: { droneId: string }) {
  const batch = useDisplayedDetectionBatch(droneId);
  const designated = useSelectedTargetStore((s) => s.designated);
  const setMarks = useCockpitMarksStore((s) => s.setMarks);
  const clearSource = useCockpitMarksStore((s) => s.clearSource);

  const historyRef = useRef<TrackSample[]>([]);
  const trackRef = useRef<string | null>(null);

  const here = designated && designated.droneId === droneId ? designated : null;
  // The lead is drawn over the displayed video, so only a target designated on
  // the displayed camera gets one. Track ids repeat across cameras: identity is
  // (camera, track).
  const trackKey =
    here?.trackId != null && batch && here.cameraId === batch.cameraId
      ? `${here.cameraId}:${here.trackId}`
      : null;
  const trackId = trackKey != null ? here?.trackId ?? null : null;

  useEffect(() => {
    // A new designated track (or camera) starts a fresh history.
    if (trackRef.current !== trackKey) {
      trackRef.current = trackKey;
      historyRef.current = [];
    }

    // Only a tracked target on a fresh feed gets a lead.
    if (trackId == null || !batch) {
      clearSource(SOURCE);
      return;
    }
    const ageMs = Date.now() - batch.receivedAt;
    const det =
      ageMs <= DETECTION_STALE_MS
        ? batch.detections.find((d) => d.trackId === trackId && d.bbox)
        : undefined;
    if (!det?.bbox) {
      clearSource(SOURCE);
      return;
    }

    const bbox = det.bbox;
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    historyRef.current = pushLeadSample(
      historyRef.current,
      { t: batch.receivedAt, cx, cy },
      LEAD_HISTORY_MS,
    );

    const lead = computeLead(
      historyRef.current,
      LEAD_MS,
      MIN_LEAD_SPEED_PX_PER_SEC,
    );
    if (!lead) {
      // Tracked but stationary (or too few samples) → no fabricated heading.
      clearSource(SOURCE);
      return;
    }

    const { width: w, height: h } = bbox;
    const marks: CockpitMark[] = [
      {
        id: `${SOURCE}:vec`,
        kind: "polyline",
        points: [
          [cx, cy],
          [lead.cx, lead.cy],
        ],
        color: LEAD_COLOR,
        width: 2,
      },
      {
        id: `${SOURCE}:reticle`,
        kind: "reticle",
        x: lead.cx - w / 2,
        y: lead.cy - h / 2,
        width: w,
        height: h,
        color: LEAD_COLOR,
      },
      {
        id: `${SOURCE}:dot`,
        kind: "point",
        x: lead.cx,
        y: lead.cy,
        radius: 3,
        color: LEAD_COLOR,
      },
    ];
    setMarks(SOURCE, marks);
    // No further batch may ever arrive: drop the lead at the stale deadline.
    const staleTimer = setTimeout(
      () => clearSource(SOURCE),
      DETECTION_STALE_MS - ageMs + 1,
    );
    return () => clearTimeout(staleTimer);
  }, [batch, trackId, trackKey, setMarks, clearSource]);

  // Drop the lead marks on unmount / drone switch so B never shows A's lead.
  useEffect(() => {
    return () => clearSource(SOURCE);
  }, [droneId, clearSource]);

  return null;
}
