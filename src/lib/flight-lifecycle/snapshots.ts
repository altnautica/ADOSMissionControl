/**
 * Snapshot helpers captured at arm time: the pre-flight checklist + sensor
 * health bitmasks, and the active geofence configuration.
 *
 * Both read from Zustand stores and return undefined when nothing relevant
 * is configured, so callers can drop the field from the resulting
 * FlightRecord entirely.
 *
 * @module flight-lifecycle/snapshots
 */

import { useChecklistStore } from "@/stores/checklist-store";
import { usePrearmBufferStore } from "@/stores/prearm-buffer-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import type {
  GeofenceSnapshot,
  GeofenceSnapshotZone,
  PreflightSnapshot,
  PreflightChecklistItem,
} from "../types";

export function capturePreflightSnapshot(droneId: string): PreflightSnapshot | undefined {
  const checklist = useChecklistStore.getState();
  // The checklist session belongs to one drone. Another drone's session says
  // nothing about this one, so the record carries no checklist at all.
  const ownSession = checklist.droneId === droneId;
  const items: PreflightChecklistItem[] = ownSession
    ? checklist.items.map((i) => ({
        id: i.id,
        category: i.category,
        label: i.label,
        status: i.status,
        type: i.type,
        displayValue: i.displayValue,
      }))
    : [];
  const checklistComplete = checklist.isReadyToArm(droneId);

  // Drain the prearm STATUSTEXT buffer the bridge has been filling.
  const prearmFailures = usePrearmBufferStore.getState().drain(droneId);

  // SYS_STATUS bitmasks at arm time — these come from the latest sysStatus
  // ring buffer entry. ArduPilot stores sensor health/present/enabled bitmasks
  // here per the MAVLink SYS_STATUS message.
  const latestSys = useTelemetryStore.getState().sysStatus.latest();

  // If there's nothing to capture, return undefined to keep the FlightRecord clean.
  const hasAnything =
    items.length > 0 ||
    prearmFailures.length > 0 ||
    latestSys?.sensorsHealthy !== undefined;
  if (!hasAnything) return undefined;

  return {
    checklistSessionId: ownSession ? (checklist.sessionId ?? undefined) : undefined,
    checklistStartedAt: ownSession ? (checklist.startedAt ?? undefined) : undefined,
    checklistItems: items,
    checklistComplete,
    sysStatusHealth: latestSys?.sensorsHealthy,
    sysStatusPresent: latestSys?.sensorsPresent,
    sysStatusEnabled: latestSys?.sensorsEnabled,
    prearmFailures,
  };
}

export function captureGeofenceSnapshot(): GeofenceSnapshot | undefined {
  const fence = useGeofenceStore.getState();
  // Skip the snapshot entirely when nothing is configured.
  const hasLegacyCircle = fence.circleCenter !== null && fence.circleRadius > 0;
  const hasLegacyPolygon = fence.polygonPoints.length >= 3;
  const hasZones = fence.zones && fence.zones.length > 0;
  const hasAltitude = fence.maxAltitude > 0 || fence.minAltitude > 0;
  if (!fence.enabled && !hasLegacyCircle && !hasLegacyPolygon && !hasZones && !hasAltitude) {
    return undefined;
  }

  const zones: GeofenceSnapshotZone[] = [];

  // Convert legacy single-fence into a synthetic inclusion zone so the
  // forensics module can treat both legacy and multi-zone uniformly.
  if (hasLegacyCircle && fence.fenceType === "circle") {
    zones.push({
      id: "legacy-circle",
      role: "inclusion",
      type: "circle",
      circleCenter: fence.circleCenter ?? undefined,
      circleRadius: fence.circleRadius,
    });
  }
  if (hasLegacyPolygon && fence.fenceType === "polygon") {
    zones.push({
      id: "legacy-polygon",
      role: "inclusion",
      type: "polygon",
      polygonPoints: fence.polygonPoints,
    });
  }
  // Multi-zone entries.
  if (hasZones) {
    for (const z of fence.zones) {
      zones.push({
        id: z.id,
        role: z.role,
        type: z.type,
        polygonPoints: z.type === "polygon" ? z.polygonPoints : undefined,
        circleCenter: z.type === "circle" ? z.circleCenter ?? undefined : undefined,
        circleRadius: z.type === "circle" ? z.circleRadius : undefined,
      });
    }
  }

  return {
    enabled: fence.enabled,
    maxAltitude: fence.maxAltitude > 0 ? fence.maxAltitude : undefined,
    minAltitude: fence.minAltitude > 0 ? fence.minAltitude : undefined,
    zones: zones.length > 0 ? zones : undefined,
  };
}
