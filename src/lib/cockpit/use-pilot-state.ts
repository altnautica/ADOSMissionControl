/**
 * @module cockpit/use-pilot-state
 * @description The drone's `pilot` kind for the cockpit shell, with its age,
 * and the chip view evaluated by the shared chip rules (`@/lib/hud`).
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import type { PilotState } from "@/lib/hud/cockpit-frames";
import { chipInputs } from "@/lib/hud/chip-inputs";
import { flightStateChip, type ChipView } from "@/lib/hud/flight-state";
import { specText } from "@/lib/hud/spec-text";
import tokens from "@/lib/cockpit-spec/tokens.json";
import { getFrames } from "@/lib/cockpit/layers/frame-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { freshOnly } from "@/lib/telemetry/freshness";
import { chipHomeDistance } from "@/lib/cockpit/home-distance";

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

/** The chip shown while the drone has never sent a pilot state. */
export const NO_PILOT_CHIP: ChipView = {
  ruleId: "no_pilot",
  text: specText("chip.no_pilot"),
  color: (tokens.state as Record<string, string>).fc,
  dim: true,
  button: null,
  secondary: [],
};

/** The flight-state chip for a drone, re-evaluated as the pilot kind ages. */
export function useFlightStateChip(droneId: string | null | undefined): ChipView {
  const { pilot, receivedAt } = usePilotState(droneId);
  const [now, setNow] = useState(() => Date.now());
  const complete = pilot?.mission?.state === "complete";
  // When `complete` was first seen (derived state, adjusted during render).
  const [completeAt, setCompleteAt] = useState<number | null>(null);
  if (complete !== (completeAt !== null)) setCompleteAt(complete ? now : null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), CHIP_TICK_MS);
    return () => clearInterval(t);
  }, []);

  if (!pilot || receivedAt === null) return NO_PILOT_CHIP;

  // The chip re-renders on its own tick, so the telemetry is read, not
  // subscribed. HOME_POSITION is latched (rare, changes only on arm/set-home).
  const tel = useTelemetryStore.getState();
  const local = freshOnly(tel.localPosition.latest(), now);
  const pos = freshOnly(tel.position.latest(), now);
  const home = tel.homePosition.latest() ?? null;
  const homeDistM = chipHomeDistance(droneId, now, home, pos ?? null);
  const ar = droneId ? getFrames(droneId).ar : null;

  return flightStateChip(
    chipInputs(pilot, now, receivedAt, {
      homeDistM,
      localPos: local ? { x: local.x, y: local.y } : null,
      arFrame: ar?.frame ?? null,
      arAgeMs: ar ? now - ar.receivedAt : 0,
      modeDetail: pilot.ownerLabel ?? null,
      completeAgeMs: completeAt === null ? null : now - completeAt,
    }),
  );
}
