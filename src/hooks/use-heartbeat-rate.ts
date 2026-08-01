"use client";

/**
 * @module use-heartbeat-rate
 * @description Derive the MAVLink HEARTBEAT arrival rate (Hz) GCS-side for the
 * selected drone. The direct MAVLink stream carries HEARTBEAT but no rate
 * field, so this hook keeps a short ring of recent HEARTBEAT arrival
 * timestamps and computes a moving-average Hz plus a `stale` flag when the
 * newest beat is older than ~3x the expected 1 Hz period. No agent change —
 * pure GCS derivation over the `DroneProtocol` heartbeat callback.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { useDroneManager } from "@/stores/drone-manager";

/** Number of recent beats averaged. */
const WINDOW = 6;
/** ArduPilot / PX4 emit HEARTBEAT at ~1 Hz; older than 3x that = stale. */
const STALE_MS = 3000;

export interface HeartbeatRate {
  /** Moving-average arrival rate in Hz, or null when not enough beats yet. */
  hz: number | null;
  /** True when the newest beat is older than ~3x the expected period. */
  stale: boolean;
}

export function useHeartbeatRate(): HeartbeatRate {
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);
  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const stampsRef = useRef<number[]>([]);
  const [rate, setRate] = useState<HeartbeatRate>({ hz: null, stale: false });

  // Subscribe to the selected drone's HEARTBEAT stream and ring-buffer arrivals.
  useEffect(() => {
    stampsRef.current = [];
    // Reset the reading when the selected drone changes so the prior drone's
    // rate never bleeds into the new one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRate({ hz: null, stale: false });
    const protocol = getProtocol();
    if (!protocol) return;
    const unsub = protocol.onHeartbeat(() => {
      const ring = stampsRef.current;
      ring.push(Date.now());
      if (ring.length > WINDOW) ring.splice(0, ring.length - WINDOW);
    });
    return unsub;
  }, [getProtocol, selectedId]);

  // Recompute once a second so the reading decays to stale when beats stop.
  useEffect(() => {
    const id = setInterval(() => {
      const ring = stampsRef.current;
      const last = ring[ring.length - 1];
      // An empty ring (FC connected but no HEARTBEAT yet, or just after a
      // drone switch) must read stale once subscribed past the horizon,
      // not healthy — otherwise a silent link shows `stale: false` forever.
      const stale = last === undefined ? true : Date.now() - last > STALE_MS;
      if (ring.length < 2) {
        setRate({ hz: null, stale });
        return;
      }
      const span = ring[ring.length - 1] - ring[0];
      const intervals = ring.length - 1;
      const raw = span > 0 ? (intervals / span) * 1000 : null;
      const hz = raw != null && Number.isFinite(raw) ? raw : null;
      setRate({ hz, stale });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  return rate;
}
