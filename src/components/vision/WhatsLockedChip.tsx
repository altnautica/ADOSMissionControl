"use client";

/**
 * @module vision/WhatsLockedChip
 * @description The "what's locked" chip (icon tile · who/state · confidence).
 * The single, shared readout of the target the vision engine acknowledged as
 * designated: class + track id, its live state and confidence read from the
 * designated camera's detection stream by track id, and a release control.
 * Shown only while a target is designated on this drone. Styling is
 * `.ados-cockpit .lockchip` (track colour).
 *
 * State word, first match wins:
 *  1. a stale feed → the stale reason ("Feed stale" / "Offload link lost");
 *  2. a fresh follow-me phase → Following, Acquiring, Predicting 18 s,
 *     Moving to look 14 s, Searching 9 s (the seconds left of the search
 *     budget), Holding · No range, Waiting for you (in the critical colour);
 *  3. a `follow.reacquired` event within 4 s → "Re-acquired · 0.86";
 *  4. the tracker's lock words (Locked, Uncertain, Lost, Not in view, Waiting
 *     for feed).
 * Confidence comes only from the live detection, never from the click-time
 * copy, so a target out of view shows "—".
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import { Crosshair, X } from "lucide-react";

import { hasSpecString, specString } from "@/lib/cockpit/spec-strings";
import { useCameraDetectionBatch } from "@/hooks/use-detection-batch";
import { useFollowStateEntry } from "@/hooks/use-nav-feed";
import { useClockTick } from "@/lib/agent/freshness";
import type { FollowState } from "@/lib/hud/nav-types";
import { perceptionFeedState, staleReason } from "@/lib/vision/perception-health";
import { classWord, holdReasonWord } from "@/lib/vision/target-format";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useClockStore } from "@/stores/clock-store";
import { FOLLOW_STALE_MS, useNavStreamStore } from "@/stores/nav-stream-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import type { LockState } from "@/stores/vision-detections-store";

/** How long the chip reads "Re-acquired" after the event. */
export const REACQUIRED_WORD_MS = 4000;

/** The `hud` namespace translator. */

/** Word for a live lock state. */
function lockLabel(state: LockState | null | undefined): string {
  switch (state) {
    case "locked":
      return specString("lock.locked");
    case "uncertain":
      return specString("lock.uncertain");
    case "lost":
      return specString("nav_source.q.lost");
    default:
      return specString("follow.tracking");
  }
}

/** The follow-me phase word, or null for idle. */
function phaseWord(f: FollowState): string | null {
  switch (f.phase) {
    case "following":
      return specString("lock.following");
    case "acquiring":
      return specString("lock.acquiring");
    case "predicting":
    case "repositioning":
    case "searching": {
      const word = specString(`follow.phase.${f.phase}`);
      const left = f.reacquireRemainingS;
      return left !== null ? `${word} ${Math.max(0, Math.ceil(left))} s` : word;
    }
    case "holding": {
      // A follow-me hold reason reads its spec label ("Camera lost"); an
      // agent `HOLD_*` code reads as its words.
      const key = `follow.hold_reason.${f.holdReason}`;
      if (f.holdReason && hasSpecString(key)) return specString("lock.holding", { label: specString(key) });
      const reason = holdReasonWord(f.holdReason);
      return reason
        ? specString("lock.holding", { label: reason.charAt(0) + reason.slice(1).toLowerCase() })
        : specString("lock.holding_bare");
    }
    case "holding-await-operator":
      return specString("lock.awaiting");
    default:
      return null;
  }
}

export function WhatsLockedChip({ droneId }: { droneId: string }) {
  const designated = useSelectedTargetStore((s) => s.designated);
  const release = useSelectedTargetStore((s) => s.release);
  const here = designated && designated.droneId === droneId ? designated : null;
  const batch = useCameraDetectionBatch(droneId, here?.cameraId ?? null);
  const tier = useAgentCapabilitiesStore((s) => s.perceptionTier);
  const follow = useFollowStateEntry(here ? droneId : null);
  const event = useNavStreamStore((s) => (here ? s.byDrone[droneId]?.followEvent : undefined));

  // Age the feed on the shared 1 Hz clock so the chip flips to "feed stale"
  // when the stream stops, not only when a fresh batch happens to arrive.
  useClockTick();
  const [now, setNow] = useState(Date.now);
  useEffect(() => useClockStore.subscribe((s) => setNow(s.now)), []);

  if (!here) return null;

  const feed = perceptionFeedState(batch, now);
  const stale = feed === "stale";

  // Only a detection in a fresh batch of the designated camera is live.
  const live =
    feed === "fresh" && here.trackId != null && batch
      ? batch.detections.find((d) => d.trackId === here.trackId)
      : undefined;
  const notInView = feed === "fresh" && !live;

  const fresh = follow && now - follow.receivedAt <= FOLLOW_STALE_MS ? follow.data : null;
  const followWord = fresh ? phaseWord(fresh) : null;
  const reacquired =
    event && event.data.topic === "follow.reacquired" && now - event.receivedAt <= REACQUIRED_WORD_MS
      ? event.data
      : null;

  let label: string;
  if (stale) label = staleReason(tier);
  else if (followWord) label = followWord;
  else if (reacquired) label = specString("lock.reacquired", { sim: reacquired.similarity.toFixed(2) });
  else if (here.trackId == null) label = specString("lock.untracked");
  else if (live) label = lockLabel(live.lockState);
  else label = feed === "fresh" ? specString("lock.not_in_view") : specString("target.waiting_for_feed");

  const awaiting = !stale && fresh?.phase === "holding-await-operator";
  const warnColor = (stale && tier === "offload") || awaiting ? "var(--hud-crit)" : "var(--hud-warn)";
  const warn = stale || awaiting || (notInView && !followWord);
  const cls = classWord(here.classLabel).trim() || specString("lock.target_fallback");
  const who = here.trackId != null ? specString("lock.who", { label: cls, id: here.trackId }) : cls;

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
        <small>{specString("lock.conf")}</small>
      </div>
      <button
        type="button"
        onClick={release}
        aria-label={specString("target.release_target")}
        title={specString("target.release_target")}
        className="text-on-media/60 hover:text-on-media"
        style={{ pointerEvents: "auto" }}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
