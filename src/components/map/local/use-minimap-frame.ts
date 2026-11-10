"use client";

/**
 * @module map/local/use-minimap-frame
 * @description The cockpit minimap's frame for one vehicle: the operator's
 * persisted `AUTO | LOCAL | MAP` pin, the GPS fix (local after 2 s below 3D)
 * and the active EKF horizontal-position source (local on ExternalNav or
 * None). An automatic switch into the local frame raises one advisory toast.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import { useNavSource } from "@/hooks/use-nav-source";
import {
  activePosxySource,
  nextNoFixSince,
  resolveMinimapMode,
  type MinimapFrame,
  type MinimapLocalReason,
  type MinimapPin,
} from "@/lib/hud/minimap-mode";
import { specString } from "@/lib/cockpit/spec-strings";
import { freshOnly } from "@/lib/telemetry/freshness";
import { useMinimapModeStore } from "@/stores/minimap-mode-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

export interface MinimapFrameState {
  frame: MinimapFrame;
  reason: MinimapLocalReason;
  pin: MinimapPin;
  setPin: (pin: MinimapPin) => void;
}

export function useMinimapFrame(droneId: string): MinimapFrameState {
  const { toast } = useToast();
  const pin = useMinimapModeStore((s) => s.pinByVehicle[droneId] ?? "auto");
  const setStoredPin = useMinimapModeStore((s) => s.setPin);
  // Re-renders at 1 Hz and on telemetry, which drives the 2 s hold below.
  const navSource = useNavSource(droneId);

  const now = Date.now();
  const gps = freshOnly(useTelemetryStore.getState().gps.latest(), now);
  const [noFixSince, setNoFixSince] = useState<number | null>(null);
  const nextSince = nextNoFixSince(noFixSince, gps?.fixType ?? null, now);
  if (nextSince !== noFixSince) setNoFixSince(nextSince);

  const { frame, reason } = resolveMinimapMode({
    pin,
    noFixSince: nextSince,
    now,
    activePosxy: activePosxySource(navSource.params, navSource.result.activeSet),
  });

  const prevFrame = useRef<MinimapFrame>("global");
  useEffect(() => {
    if (frame === "local" && prevFrame.current !== "local" && reason !== "pinned") {
      toast(specString("minimap.toast_local"), "info");
    }
    prevFrame.current = frame;
  }, [frame, reason, toast]);

  return { frame, reason, pin, setPin: (p) => setStoredPin(droneId, p) };
}
