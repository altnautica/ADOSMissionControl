"use client";

/**
 * @module vision/WhatsLockedChip
 * @description The "what's locked" chip (icon tile · who/state · confidence).
 * The single, shared, honest readout of the target the vision engine
 * acknowledged as designated: class + track id, its LIVE lock state and
 * confidence read from the designated camera's detection stream by track id,
 * and a release control. Shown only while a target is designated on this
 * drone. Styling is `.ados-cockpit .lockchip`.
 *
 * Honest "why did the lock go away": a fresh feed without the designated track
 * reads "Not in view"; a stale feed reads "Feed stale" / "Offload link lost".
 * Confidence comes only from the live detection, never from the click-time
 * copy, so a target out of view shows "—".
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { Crosshair, X } from "lucide-react";

import { useCameraDetectionBatch } from "@/hooks/use-detection-batch";
import { perceptionFeedState, staleReason } from "@/lib/vision/perception-health";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { LockState } from "@/stores/vision-detections-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";

/** Human label for a live lock state. */
function lockLabel(state: LockState | null | undefined): string {
  switch (state) {
    case "locked":
      return "Locked";
    case "uncertain":
      return "Uncertain";
    case "lost":
      return "Lost";
    default:
      return "Tracking";
  }
}

export function WhatsLockedChip({ droneId }: { droneId: string }) {
  const designated = useSelectedTargetStore((s) => s.designated);
  const release = useSelectedTargetStore((s) => s.release);
  const here = designated && designated.droneId === droneId ? designated : null;
  const batch = useCameraDetectionBatch(droneId, here?.cameraId ?? null);
  const tier = useAgentCapabilitiesStore((s) => s.perceptionTier);

  const [now, setNow] = useState(() => Date.now());

  // Age the feed on its own so the chip flips to "feed stale" when the stream
  // stops, not only when a fresh batch happens to arrive. Keyed on whether a
  // feed EXISTS, not the batch object (replaced every frame), so the interval
  // is created once per feed lifecycle. Hooks stay above the early return.
  const hasFeed = !!batch;
  useEffect(() => {
    if (!hasFeed) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [hasFeed]);

  if (!here) return null;

  const feed = perceptionFeedState(batch, now);
  const stale = feed === "stale";

  // Only a detection in a fresh batch of the designated camera is live.
  const live =
    feed === "fresh" && here.trackId != null && batch
      ? batch.detections.find((d) => d.trackId === here.trackId)
      : undefined;
  const notInView = feed === "fresh" && !live;

  let label: string;
  if (stale) label = staleReason(tier);
  else if (here.trackId == null) label = "Untracked";
  else if (live) label = lockLabel(live.lockState);
  else label = feed === "fresh" ? "Not in view" : "Waiting for feed";

  const warnColor = stale && tier === "offload" ? "var(--crit)" : "var(--warn)";
  const warn = stale || notInView;
  const who =
    here.trackId != null
      ? `${here.classLabel} · trk ${here.trackId}`
      : here.classLabel;

  return (
    <div
      className="lockchip"
      data-target-interactive
      style={{
        left: "50%",
        top: 48,
        transform: "translateX(-50%)",
        ...(warn ? { borderColor: warnColor } : {}),
      }}
      data-cockpit-widget="whats-locked"
      data-feed-state={feed}
    >
      <div className="ic">
        <Crosshair size={14} aria-hidden="true" />
      </div>
      <div className="who">
        <b>{who}</b>
        <span style={warn ? { color: warnColor } : undefined}>{label}</span>
      </div>
      <div className="rng">
        {live ? `${Math.round(live.confidence * 100)}%` : "—"}
        <small>conf</small>
      </div>
      <button
        type="button"
        onClick={release}
        aria-label="Release target"
        title="Release target"
        className="text-white/60 hover:text-white"
        style={{ pointerEvents: "auto" }}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
