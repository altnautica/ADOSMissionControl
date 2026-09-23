"use client";

/**
 * @module Px4EventsBridge
 * @description Subscribes to the selected PX4 drone's structured events (MAVLink
 * EVENT msg 410), fetches the FC-served events metadata once, and pushes decoded
 * events into `px4-events-store` so the Logs → Events feed can render them.
 * Runs once (mounted in CommandShell); re-scopes to the selected drone and
 * clears on drone switch. No-op for non-PX4 firmwares (they never emit events).
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { usePx4EventsStore } from "@/stores/px4-events-store";
import { isDemoMode } from "@/lib/utils";
import { fetchPx4LiveEventMetadata } from "@/lib/protocol/param-metadata/px4-event-metadata";

export function Px4EventsBridge() {
  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const firmwareType = useDroneManager((s) => {
    const d = s.selectedDroneId ? s.drones.get(s.selectedDroneId) : null;
    return d?.vehicleInfo.firmwareType ?? null;
  });

  useEffect(() => {
    usePx4EventsStore.getState().clear();
    const drone = useDroneManager.getState().getSelectedDrone();
    if (!drone || firmwareType !== "px4") return;
    const protocol = drone.protocol;

    // A metadata fetch that lands after a drone switch belongs to the old
    // drone and is dropped.
    let cancelled = false;
    const metadataLoad = isDemoMode()
      ? // Demo mode has no FC-served metadata — seed a small bundled map so
        // the synthetic mock events render with decoded text.
        import("@/mock/px4-demo-events").then((m) => m.DEMO_PX4_EVENT_METADATA)
      : fetchPx4LiveEventMetadata(protocol);
    void metadataLoad.then((metadata) => {
      if (!cancelled) usePx4EventsStore.getState().setMetadata(metadata);
    });

    const unsub = protocol.onEvent((ev) =>
      usePx4EventsStore.getState().pushRaw({
        id: ev.id,
        logLevels: ev.logLevels,
        arguments: ev.arguments,
        eventTimeBootMs: ev.eventTimeBootMs,
      }),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [selectedId, firmwareType]);

  return null;
}
