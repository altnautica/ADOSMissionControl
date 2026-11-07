/**
 * @module cockpit/use-pilot-state
 * @description The drone's `pilot` kind for the cockpit shell, with its age,
 * and the chip view evaluated from the shared spec.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import type { PilotState } from "@/lib/cockpit/layers/cockpit-frames";
import { evaluateChip, type ChipView } from "@/lib/cockpit/flight-state";
import { useMissionStatus } from "@/lib/mission/use-mission-status";
import { useNavStreamStore } from "@/stores/nav-stream-store";

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

  return evaluateChip({
    pilot,
    pilotAgeMs: receivedAt === null ? Number.POSITIVE_INFINITY : now - receivedAt,
    mission,
    completeSinceMs: track.since,
    now,
  });
}
