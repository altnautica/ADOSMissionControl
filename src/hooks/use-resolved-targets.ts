"use client";

/**
 * @module use-resolved-targets
 * @description Feeds the HUD target resolver for one video: the camera's
 * detection batch (dropped once stale), the designated target, the follow-me
 * state and its last event, the vehicle yaw and the video-lost flag, all aged
 * against one clock. The clock is the shared 1 Hz tick, advanced to the newest
 * input on arrival and woken at the next timed edge (re-acquired snap end,
 * LOST fade end) so short-lived states start and end on time.
 *
 * With `remember`, the hook also keeps the followed box's last rect (the LOST
 * mark fades there) and its recent bottom-centre samples (the COASTING ghost
 * path).
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import { useClockTick } from "@/lib/agent/freshness";
import { useFollowStateEntry } from "@/hooks/use-nav-feed";
import { useHudCopy } from "@/hooks/use-hud-copy";
import { isTimestampFresh } from "@/hooks/use-telemetry-freshness";
import { pushGhostSample, type GhostSample } from "@/lib/vision/target-geometry";
import {
  LOST_FADE_MS,
  REACQUIRED_SNAP_MS,
  followedRect,
  resolveTargets,
  type DesignatedRef,
  type LastFollowRect,
  type ResolvedTargets,
} from "@/lib/vision/target-state";
import { useClockStore } from "@/stores/clock-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useSelectedTargetStore } from "@/stores/selected-target-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import {
  DETECTION_STALE_MS,
  type VisionDetectionBatch,
} from "@/stores/vision-detections-store";

/** Refresh the remembered followed rect at least this often while drawn. */
const MEMORY_REFRESH_MS = 100;

export interface ResolvedTargetsInput {
  droneId: string;
  batch: VisionDetectionBatch | undefined;
  /** Camera this video shows, used when no fresh batch names it. */
  cameraId: string | null;
  videoLost: boolean;
  /** Mount yaw of this camera (0 front); null for a down-facing camera. */
  cameraYawOffsetDeg: number | null;
  pip?: boolean;
  /** Keep the last followed rect and ghost samples (LOST, ghost path). */
  remember?: boolean;
}

export interface ResolvedTargetsResult {
  resolved: ResolvedTargets;
  now: number;
  /** The batch, when fresh and drawable; null otherwise. */
  freshBatch: VisionDetectionBatch | null;
  ghost: readonly GhostSample[];
}

interface FollowMemory {
  last: LastFollowRect | null;
  ghost: GhostSample[];
}

const EMPTY_MEMORY: FollowMemory = { last: null, ghost: [] };

/** Vehicle yaw (deg) from a fresh ATTITUDE, else a fresh position heading. */
function vehicleYawDeg(): number | null {
  const s = useTelemetryStore.getState();
  const att = s.attitude.latest();
  if (att && isTimestampFresh(att.timestamp) && Number.isFinite(att.yaw)) return att.yaw;
  const pos = s.position.latest();
  if (pos && isTimestampFresh(pos.timestamp) && typeof pos.heading === "number") return pos.heading;
  return null;
}

export function useResolvedTargets(i: ResolvedTargetsInput): ResolvedTargetsResult {
  const { droneId, batch } = i;
  const designatedAll = useSelectedTargetStore((s) => s.designated);
  const follow = useFollowStateEntry(droneId);
  const event = useNavStreamStore((s) => s.byDrone[droneId]?.followEvent);
  const selected = useDroneManager((s) => s.selectedDroneId === droneId);
  const copy = useHudCopy();

  useClockTick();
  const [clockNow, setClockNow] = useState(Date.now);
  useEffect(() => useClockStore.subscribe((s) => setClockNow(s.now)), []);

  const [memory, setMemory] = useState<FollowMemory>(EMPTY_MEMORY);

  const now = Math.max(
    clockNow,
    batch?.receivedAt ?? 0,
    follow?.receivedAt ?? 0,
    event?.receivedAt ?? 0,
  );

  const freshBatch =
    batch &&
    now - batch.receivedAt <= DETECTION_STALE_MS &&
    batch.frameWidth > 0 &&
    batch.frameHeight > 0
      ? batch
      : null;
  const cameraId = freshBatch?.cameraId ?? i.cameraId ?? "";

  const designated: DesignatedRef | null =
    designatedAll && designatedAll.droneId === droneId
      ? { cameraId: designatedAll.cameraId, trackId: designatedAll.trackId, bbox: designatedAll.bbox }
      : null;

  // Yaw only matters for the off-frame arrow; skip the store read otherwise.
  const yaw = follow?.data.phase === "searching" && selected ? vehicleYawDeg() : null;

  const resolved = resolveTargets({
    batch: freshBatch
      ? {
          cameraId: freshBatch.cameraId,
          frameWidth: freshBatch.frameWidth,
          frameHeight: freshBatch.frameHeight,
          detections: freshBatch.detections,
        }
      : null,
    cameraId,
    designated,
    follow: follow?.data ?? null,
    followAgeMs: follow ? now - follow.receivedAt : 0,
    event: event ? { data: event.data, ageMs: now - event.receivedAt } : null,
    nowMs: now,
    videoLost: i.videoLost,
    lastFollowRect: i.remember ? memory.last : null,
    vehicleYawDeg: yaw,
    cameraYawOffsetDeg: i.cameraYawOffsetDeg,
    opts: { pip: i.pip, copy },
  });

  // Remember where the followed box was drawn (render-phase update, guarded so
  // it settles in one extra pass).
  if (i.remember) {
    const fr = followedRect(resolved);
    const last = memory.last;
    if (
      fr &&
      (!last ||
        last.trackId !== fr.trackId ||
        last.rect.x !== fr.rect.x ||
        last.rect.y !== fr.rect.y ||
        last.rect.w !== fr.rect.w ||
        last.rect.h !== fr.rect.h ||
        now - last.at >= MEMORY_REFRESH_MS)
    ) {
      const sample = { t: now, x: fr.rect.x + fr.rect.w / 2, y: fr.rect.y + fr.rect.h };
      setMemory({
        last: { trackId: fr.trackId, rect: fr.rect, frameW: resolved.frameW, frameH: resolved.frameH, at: now },
        ghost: pushGhostSample(last && last.trackId === fr.trackId ? memory.ghost : [], sample),
      });
    }
  }

  // Wake at the next timed edge so a snap or fade ends without new data.
  const edges = [
    event ? event.receivedAt + REACQUIRED_SNAP_MS : 0,
    event ? event.receivedAt + LOST_FADE_MS : 0,
    i.remember && memory.last ? memory.last.at + LOST_FADE_MS : 0,
  ].filter((t) => t > now);
  const nextEdge = edges.length > 0 ? Math.min(...edges) : null;
  useEffect(() => {
    if (nextEdge === null) return;
    const id = setTimeout(() => setClockNow(Date.now()), Math.max(0, nextEdge - Date.now()) + 5);
    return () => clearTimeout(id);
  }, [nextEdge]);

  return { resolved, now, freshBatch, ghost: memory.ghost };
}
