"use client";

/**
 * @module layout/StatusTextLogBridge
 * @description Subscribes to STATUSTEXT on every connected drone's protocol
 * for the life of the shell, and fills the per-drone status log and the
 * activity count. The Logs rail used to own this subscription while it was
 * open, so messages that arrived while it was closed were lost and the
 * "updates available" dot never lit.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStatusLogStore } from "@/stores/drone-status-log-store";
import { useLogActivityStore } from "@/stores/log-activity-store";

type Protocol = ManagedDrone["protocol"];

export function StatusTextLogBridge() {
  useEffect(() => {
    const subs = new Map<string, { protocol: Protocol; unsub: () => void }>();

    const sync = () => {
      const drones = useDroneManager.getState().drones;
      for (const [droneId, sub] of subs) {
        if (drones.get(droneId)?.protocol !== sub.protocol) {
          sub.unsub();
          subs.delete(droneId);
        }
      }
      for (const [droneId, drone] of drones) {
        const protocol = drone.protocol;
        if (!protocol || subs.has(droneId)) continue;
        const unsub = protocol.onStatusText((data) => {
          useDroneStatusLogStore.getState().append(droneId, data.severity, data.text);
          useLogActivityStore.getState().bump(droneId);
        });
        subs.set(droneId, { protocol, unsub });
      }
    };

    sync();
    const stop = useDroneManager.subscribe((s, prev) => {
      if (s.drones !== prev.drones) sync();
    });
    return () => {
      stop();
      for (const sub of subs.values()) sub.unsub();
      subs.clear();
    };
  }, []);
  return null;
}
