/**
 * @module cockpit/use-pilot-state
 * @description The drone's `pilot` kind for the cockpit shell, with its age,
 * and the chip view evaluated from the shared spec.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import type { PilotState } from "@/lib/hud/cockpit-frames";
import { evaluateChip, nextWaypointEtaS, type ChipView } from "@/lib/cockpit/flight-state";
import { getFrames } from "@/lib/cockpit/layers/frame-store";
import { LAYER_HIDE_MS } from "@/lib/cockpit/layers/layer-spec";
import { useMissionStatus } from "@/lib/mission/use-mission-status";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { freshOnly } from "@/lib/telemetry/freshness";
import { haversineDistance } from "@/lib/geo/distance";

/** Re-render cadence of the chip (staleness and the 10 s complete chip). */
const CHIP_TICK_MS = 500;

export interface PilotStateView {
  pilot: PilotState | null;
  receivedAt: number | null;
}

export function usePilotState(droneId: string | null | undefined): PilotStateView {
  const stamped = useNavStreamStore((s) => (droneId ? s.byDrone[droneId]?.pilot : undefined));
  return { pilot: stamped?.data ?? null, receivedAt: stamped?.receivedAt ?? null };
}

/** The flight-state chip for a drone, re-evaluated as the pilot kind ages. */
export function useFlightStateChip(droneId: string | null | undefined): ChipView {
  const { pilot, receivedAt } = usePilotState(droneId);
  const mission = useMissionStatus(droneId);
  const [now, setNow] = useState(() => Date.now());
  const complete = mission?.state === "complete";
  // When `complete` was first seen (derived state, adjusted during render).
  const [track, setTrack] = useState<{ complete: boolean; since: number | null }>({
    complete: false,
    since: null,
  });
  if (track.complete !== complete) {
    setTrack({ complete, since: complete ? now : null });
  }

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CHIP_TICK_MS);
    return () => clearInterval(t);
  }, []);

  // The chip re-renders on its own tick, so the telemetry is read, not
  // subscribed. HOME_POSITION is latched (rare, changes only on arm/set-home).
  const tel = useTelemetryStore.getState();
  const local = freshOnly(tel.localPosition.latest(), now);
  const pos = freshOnly(tel.position.latest(), now);
  const home = tel.homePosition.latest() ?? null;
  const homeDistM =
    home && pos && pos.lat !== 0 && pos.lon !== 0 ? haversineDistance(home.lat, home.lon, pos.lat, pos.lon) : null;
  // The next gate's ETA from the drone's `ar` frame, while the frame is fresh
  // (the layers' 2 s hide rule).
  const ar = droneId ? getFrames(droneId).ar : null;
  const etaS = ar && now - ar.receivedAt < LAYER_HIDE_MS ? nextWaypointEtaS(ar.frame) : null;

  return evaluateChip({
    pilot,
    vehicleNe: local ? [local.x, local.y] : null,
    homeDistM,
    etaS,
    pilotAgeMs: receivedAt === null ? Number.POSITIVE_INFINITY : now - receivedAt,
    mission,
    completeSinceMs: track.since,
    now,
  });
}
