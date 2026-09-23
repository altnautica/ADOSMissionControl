/**
 * @module use-sensor-health
 * @description The selected drone's sensor health, decoded once from its
 * latest SYS_STATUS and gated on freshness.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { decodeSensorHealth, sensorCounts, type SensorInfo } from "@/lib/sensor-health";

export interface SensorHealthReading {
  /** Every defined sensor bit, or null when no SYS_STATUS is fresh. */
  sensors: SensorInfo[] | null;
  healthyCount: number;
  presentCount: number;
  /** When the fresh SYS_STATUS was received; undefined with no fresh report. */
  updatedAt: number | undefined;
  /** True once any SYS_STATUS arrived, so "stale" can be told from "never". */
  heard: boolean;
}

export function useSensorHealth(): SensorHealthReading {
  // Re-renders on every telemetry push and on the shared clock, and drops the
  // report once it stops arriving: the ring keeps its last sample on link loss.
  const sysStatus = useFreshTelemetry("sysStatus");
  const heard = sysStatus !== undefined || useTelemetryStore.getState().sysStatus.latest() !== undefined;
  const sensors = useMemo(() => (sysStatus ? decodeSensorHealth(sysStatus) : null), [sysStatus]);
  const counts = sensors ? sensorCounts(sensors) : { healthy: 0, present: 0 };
  return {
    sensors,
    healthyCount: counts.healthy,
    presentCount: counts.present,
    updatedAt: sysStatus?.timestamp,
    heard,
  };
}
