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
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";

export function CockpitPerceptionChip({ droneId }: { droneId: string }) {
  const batch = useVisionDetectionsStore((s) => s.batches[droneId]);
  const tier = useAgentCapabilitiesStore((s) => s.perceptionTier);
  const target = useAgentCapabilitiesStore((s) => s.perceptionOffloadTarget);

  // The shared 1 Hz tick re-renders the chip so the feed ages from fresh to
  // stale on its own even when no new batch arrives (the exact case this chip
  // exists to catch).
  useClockTick();
  const [now, setNow] = useState(Date.now);
  useEffect(() => useClockStore.subscribe((s) => setNow(s.now)), []);

  const feed = perceptionFeedState(batch, now);
  const label = tierLabel(tier, feed !== "idle");

  // Nothing to show: no feed ever AND no running tier → this drone is not doing
  // perception, so stay out of the way (never a fabricated placeholder).
  if (feed === "idle" && label === null) return null;

  const stale = feed === "stale";
  const crit = stale && tier === "offload";
  const stateClass = feed === "fresh" ? "fresh" : crit ? "crit" : stale ? "warn" : "";

  return (
    <div
      className={`perchip ${stateClass}`.trim()}
      style={{ left: 18, top: 176 }}
      data-cockpit-widget="perception-health"
      data-feed-state={feed}
    >
      <span className="dot" aria-hidden="true" />
      <span className="body">
        <span className="tier">
          {label}
          {tier === "offload" && target ? (
            <span className="tgt"> · {target}</span>
          ) : null}
        </span>
        {stale ? <span className="reason">{staleReason(tier)}</span> : null}
      </span>
    </div>
  );
}
