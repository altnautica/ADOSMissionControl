/**
 * @module use-upload-status
 * @description Whether the selected drone holds the mission, fence or rally
 * set the planner shows right now. Derived from the upload receipt for that
 * drone and a hash of the current content, so an edit, a plan load or a drone
 * switch changes the answer immediately.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo } from "react";
import { useDroneManager } from "@/stores/drone-manager";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import {
  useUploadReceiptsStore,
  receiptStatus,
  type ReceiptStatus,
  type UploadKind,
} from "@/stores/upload-receipts-store";
import { missionContentHash } from "@/lib/mission-upload";
import { fenceContentHash } from "@/lib/geofence-elements";
import { rallyContentHash } from "@/stores/rally-store";

function useSelectedReceipt(kind: UploadKind) {
  const droneId = useDroneManager((s) => s.selectedDroneId);
  return useUploadReceiptsStore((s) => (droneId ? s.receipts[droneId]?.[kind] : undefined));
}

export function useMissionUploadStatus(): ReceiptStatus {
  const receipt = useSelectedReceipt("mission");
  const waypoints = useMissionStore((s) => s.waypoints);
  // The expansion reads the planner defaults, so a change to them changes
  // what an upload would send.
  const defaultFrame = usePlannerStore((s) => s.defaultFrame);
  const defaultSpeed = usePlannerStore((s) => s.defaultSpeed);
  return useMemo(() => {
    void defaultFrame;
    void defaultSpeed;
    return receiptStatus(receipt, missionContentHash(waypoints));
  }, [receipt, waypoints, defaultFrame, defaultSpeed]);
}

export function useFenceUploadStatus(): ReceiptStatus {
  const receipt = useSelectedReceipt("fence");
  const enabled = useGeofenceStore((s) => s.enabled);
  const fenceType = useGeofenceStore((s) => s.fenceType);
  const maxAltitude = useGeofenceStore((s) => s.maxAltitude);
  const minAltitude = useGeofenceStore((s) => s.minAltitude);
  const breachAction = useGeofenceStore((s) => s.breachAction);
  const circleCenter = useGeofenceStore((s) => s.circleCenter);
  const circleRadius = useGeofenceStore((s) => s.circleRadius);
  const polygonPoints = useGeofenceStore((s) => s.polygonPoints);
  const zones = useGeofenceStore((s) => s.zones);
  return useMemo(
    () =>
      receiptStatus(
        receipt,
        fenceContentHash({
          enabled, fenceType, maxAltitude, minAltitude, breachAction,
          circleCenter, circleRadius, polygonPoints, zones,
        }),
      ),
    [receipt, enabled, fenceType, maxAltitude, minAltitude, breachAction,
      circleCenter, circleRadius, polygonPoints, zones],
  );
}

export function useRallyUploadStatus(): ReceiptStatus {
  const receipt = useSelectedReceipt("rally");
  const points = useRallyStore((s) => s.points);
  return useMemo(() => receiptStatus(receipt, rallyContentHash(points)), [receipt, points]);
}
