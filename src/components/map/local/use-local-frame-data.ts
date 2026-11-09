"use client";

/**
 * @module map/local/use-local-frame-data
 * @description Gathers the local-frame layers for one drone with their
 * freshness rules applied: the SLAM trail and occupancy grid (dimmed when the
 * last poll is older than 5 s), the scan in the map frame (only while both
 * the scan and the pose are under 500 ms old), the follow target, and the
 * drone from the pose when fresh, else from LOCAL_POSITION_NED (`fcPos`).
 * Heading comes from ATTITUDE when fresh, else from the pose.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";

import { useFollowStateEntry, useNavFeed } from "@/hooks/use-nav-feed";
import { useThrottledTelemetryVersion } from "@/hooks/use-throttled-telemetry-version";
import {
  EMPTY_OCCUPANCY,
  poseYawDeg,
  scanToMap,
  type OccupancyGrid,
  type TrailPoint,
} from "@/lib/hud/local-frame";
import type { LocalSceneDrone, LocalSceneTarget } from "@/lib/hud/local-scene";
import { freshOnly } from "@/lib/telemetry/freshness";
import {
  FOLLOW_STALE_MS,
  OCCUPANCY_DIM_MS,
  POSE_STALE_MS,
  SCAN_STALE_MS,
  freshData,
} from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

/** Redraw cadence for the age-based rules (scan and pose expire at 500 ms). */
const FRAME_TICK_MS = 250;
const NO_TRAIL: TrailPoint[] = [];

export interface LocalFrameData {
  now: number;
  trail: readonly TrailPoint[];
  occupancy: OccupancyGrid;
  occupancyStale: boolean;
  scanPoints: Array<[number, number]> | null;
  target: LocalSceneTarget | null;
  drone: LocalSceneDrone | null;
  /** The drone is placed from LOCAL_POSITION_NED, not the SLAM pose. */
  fcPos: boolean;
}

export function useLocalFrameData(droneId: string): LocalFrameData {
  const feed = useNavFeed(droneId);
  const follow = useFollowStateEntry(droneId);
  useThrottledTelemetryVersion();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), FRAME_TICK_MS);
    return () => clearInterval(id);
  }, []);

  const pose = freshData(feed?.pose, now, POSE_STALE_MS);
  const scan = freshData(feed?.scan, now, SCAN_STALE_MS);
  const scanPoints = useMemo(() => (scan && pose ? scanToMap(scan, pose) : null), [scan, pose]);

  const telemetry = useTelemetryStore.getState();
  const attitude = freshOnly(telemetry.attitude.latest(), now);
  const local = freshOnly(telemetry.localPosition.latest(), now);

  let drone: LocalSceneDrone | null = null;
  if (pose) {
    drone = { north: pose.t[0], east: pose.t[1], yawDeg: attitude?.yaw ?? poseYawDeg(pose) };
  } else if (local) {
    drone = { north: local.x, east: local.y, yawDeg: attitude?.yaw ?? 0 };
  }

  const fs = follow ? freshData(follow, now, FOLLOW_STALE_MS) : null;
  const target: LocalSceneTarget | null =
    fs?.targetNed
      ? {
          north: fs.targetNed[0],
          east: fs.targetNed[1],
          velNorth: fs.targetVelNed?.[0] ?? null,
          velEast: fs.targetVelNed?.[1] ?? null,
          dashed: fs.phase === "coasting" || fs.phase === "searching",
        }
      : null;

  const polledAt = feed?.occupancyPolledAt ?? null;
  return {
    now,
    trail: feed?.trail ?? NO_TRAIL,
    occupancy: feed?.occupancy ?? EMPTY_OCCUPANCY,
    occupancyStale: polledAt !== null && now - polledAt > OCCUPANCY_DIM_MS,
    scanPoints,
    target,
    drone,
    fcPos: !pose && local !== undefined,
  };
}
