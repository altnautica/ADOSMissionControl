/**
 * @module cockpit/home-distance
 * @description The distance from home the RTH chip shows. A paired agent
 * reports `home_distance` from GNSS or, without a fix, from the EKF local
 * frame, so while its telemetry is current that value wins. Otherwise the
 * GCS computes it from the global position against HOME_POSITION.
 * @license GPL-3.0-only
 */

import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { haversineDistance } from "@/lib/geo/distance";
import { telemetryValue } from "@/lib/nodes/presence";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";
import { useCommandFleetStore } from "@/stores/command-fleet-store";

interface LatLon {
  lat: number;
  lon: number;
}

/** The paired agent's `home_distance` (m) while its telemetry is current. */
export function agentHomeDistance(droneId: string | null | undefined, now: number): number | null {
  const deviceId = deviceIdFromNodeId(droneId);
  if (!deviceId) return null;
  const fleet = useCommandFleetStore.getState();
  const stream = fleet.telemetryByDeviceId[deviceId];
  const status = fleet.cloudStatuses[deviceId];
  const tel = telemetryValue(stream, status, now);
  if (!tel) return null;
  const at = tel === stream ? stream.receivedAt : (status?.updatedAt ?? 0);
  if (now - at >= TELEMETRY_STALE_MS) return null;
  const d = tel.home_distance;
  return typeof d === "number" && Number.isFinite(d) && d >= 0 ? d : null;
}

/** The chip's distance from home: the agent's when paired, else computed. */
export function chipHomeDistance(
  droneId: string | null | undefined,
  now: number,
  home: LatLon | null,
  pos: LatLon | null,
): number | null {
  const agent = agentHomeDistance(droneId, now);
  if (agent !== null) return agent;
  return home && pos && pos.lat !== 0 && pos.lon !== 0
    ? haversineDistance(home.lat, home.lon, pos.lat, pos.lon)
    : null;
}
