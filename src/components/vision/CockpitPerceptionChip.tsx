"use client";

/**
 * @module vision/CockpitPerceptionChip
 * @description The cockpit's perception-health chip — a small, glass, unobtrusive
 * readout of WHERE detection runs (LOCAL vs OFFLOAD ‹workstation›) and whether
 * the detection feed is actually live. A freshness dot reads green while batches
 * flow, amber when a live feed has gone stale, grey when perception is idle.
 *
 * The honesty this exists for (no fabricated reading): the box overlay correctly CLEARS its
 * boxes the moment a feed stops, which is indistinguishable from "no targets in
 * view". This chip surfaces the difference — when a feed WAS flowing and then
 * aged out (`stale`), it escalates to "Perception feed stale" / "Offload link
 * lost" instead of silently reading as "nothing to see". It never shows the
 * stale state when no feed ever started (that is just "no detections yet").
 * When the agent reports its vision engine unreachable (`available:false`),
 * the chip reads "Vision not running" until a batch arrives again.
 *
 * It reads the SAME {@link DETECTION_STALE_MS} window the box overlay uses, and
 * the resolved tier from the agent-capabilities store, so it never fabricates a
 * tier — an unknown tier with a live feed reads a neutral "PERCEPTION".
 *
 * Mounted as a registered cockpit widget (see `CockpitZones`).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { useClockTick } from "@/lib/agent/freshness";
import { useClockStore } from "@/stores/clock-store";

import {
  perceptionFeedState,
  staleReason,
  tierLabel,
} from "@/lib/vision/perception-health";
import { VISION_NOT_RUNNING_COPY, detectionVersionNotice } from "@/lib/agent/vision-detections-ws";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

export function CockpitPerceptionChip({ droneId }: { droneId: string }) {
  const batch = useVisionDetectionsStore((s) => s.batches[droneId]);
  const notRunning = useVisionDetectionsStore((s) => droneId in s.visionUnavailable);
  const outdated = useVisionDetectionsStore((s) => s.outdatedDetectionVersion[droneId]);
  const tier = useAgentCapabilitiesStore((s) => s.perceptionTier);
  const target = useAgentCapabilitiesStore((s) => s.perceptionOffloadTarget);

  // The shared 1 Hz tick re-renders the chip so the feed ages from fresh to
  // stale on its own even when no new batch arrives (the exact case this chip
  // exists to catch).
  useClockTick();
  const [now, setNow] = useState(Date.now);
  useEffect(() => useClockStore.subscribe((s) => setNow(s.now)), []);

  const feed = perceptionFeedState(batch, now);
  // A not-running engine is perception context worth showing even with no tier.
  const label = tierLabel(tier, feed !== "idle" || notRunning || outdated !== undefined);

  // Nothing to show: no feed ever AND no running tier → this drone is not doing
  // perception, so stay out of the way (never a fabricated placeholder).
  if (feed === "idle" && label === null) return null;

  // The store drops a drone's batches when it flags vision not running, and a
  // batch clears the flag, so `notRunning` always pairs with an idle feed.
  const stale = feed === "stale";
  const crit = stale && tier === "offload";
  const stateClass =
    feed === "fresh" ? "fresh" : crit ? "crit" : stale || notRunning || outdated !== undefined ? "warn" : "";
  const reason =
    outdated !== undefined
      ? detectionVersionNotice(outdated)
      : stale
        ? staleReason(tier)
        : notRunning
          ? VISION_NOT_RUNNING_COPY
          : null;

  return (
    <div
      className={`perchip ${stateClass}`.trim()}
      data-cockpit-widget="perception-health"
      data-feed-state={notRunning ? "not-running" : feed}
    >
      <span className="dot" aria-hidden="true" />
      <span className="body">
        <span className="tier">
          {label}
          {tier === "offload" && target ? (
            <span className="tgt"> · {target}</span>
          ) : null}
        </span>
        {reason ? <span className="reason">{reason}</span> : null}
      </span>
    </div>
  );
}
