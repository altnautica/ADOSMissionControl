"use client";

/**
 * @module ChecklistAutoRunner
 * @description Keeps the pre-flight checklist live for the selected drone.
 *
 * Mounted once by the shell, so the auto items follow telemetry whether or not
 * the checklist modal is open: the readiness the Arm and Take-off confirms read
 * is re-evaluated on every telemetry push and on the shared 1 Hz clock, and an
 * item whose telemetry goes stale falls back to pending. It also opens the
 * session for whichever drone is selected; `selectDrone` resets the session on
 * a switch, so a checklist never carries from one aircraft to another.
 * Renders nothing.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useChecklistStore } from "@/stores/checklist-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useMissionStore } from "@/stores/mission-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useClockTick } from "@/lib/agent/freshness";
import { useKnownCellCount } from "@/hooks/use-known-cell-count";
import { useFenceUploadStatus, useMissionUploadStatus } from "@/hooks/use-upload-status";
import { evaluateAutoChecks } from "@/lib/checklist/auto-checks";

/** MAVLink GPS_FIX_TYPE -> its `indicators.gpsFix.*` label key. */
const GPS_FIX_KEYS: Record<number, string> = {
  0: "noGps",
  1: "noFix",
  2: "fix2d",
  3: "fix3d",
  4: "dgps",
  5: "rtkFloat",
  6: "rtk",
};

export function ChecklistAutoRunner(): null {
  const tFix = useTranslations("indicators.gpsFix");
  const droneId = useDroneManager((s) => s.selectedDroneId);
  const sessionDroneId = useChecklistStore((s) => s.droneId);
  const startSession = useChecklistStore((s) => s.startSession);
  const sessionId = useChecklistStore((s) => s.sessionId);
  const applyAutoVerdicts = useChecklistStore((s) => s.applyAutoVerdicts);

  // `_version` says new telemetry arrived; the clock tick says time passed,
  // which is the only signal left once a link goes quiet.
  const version = useTelemetryStore((s) => s._version);
  const tick = useClockTick();
  const batteryBuf = useTelemetryStore((s) => s.battery);
  const gpsBuf = useTelemetryStore((s) => s.gps);
  const ekfBuf = useTelemetryStore((s) => s.ekf);
  const sysStatusBuf = useTelemetryStore((s) => s.sysStatus);
  // Only what the selected drone acknowledged counts: a planned mission or a
  // drawn fence that was never uploaded (or was edited since) is not on it.
  const missionStatus = useMissionUploadStatus();
  const fenceStatus = useFenceUploadStatus();
  const waypointCount = useMissionStore((s) => s.waypoints.length);
  const geofenceEnabled = useGeofenceStore((s) => s.enabled);
  const missionOnVehicle = missionStatus === "on-aircraft" ? waypointCount : null;
  const fenceOnVehicle = fenceStatus === "on-aircraft" ? geofenceEnabled : null;
  const battery = batteryBuf.latest();
  const knownCellCount = useKnownCellCount(droneId, battery?.cellCount);

  useEffect(() => {
    if (droneId && sessionDroneId !== droneId) startSession(droneId);
  }, [droneId, sessionDroneId, startSession]);

  useEffect(() => {
    if (!droneId || sessionDroneId !== droneId) return;
    applyAutoVerdicts(
      evaluateAutoChecks(
        {
          battery,
          knownCellCount,
          gps: gpsBuf.latest(),
          ekf: ekfBuf.latest(),
          sysStatus: sysStatusBuf.latest(),
          missionOnVehicle,
          fenceOnVehicle,
          formatGpsFix: (fixType) => tFix(GPS_FIX_KEYS[fixType] ?? "fix3d"),
        },
        Date.now(),
      ),
    );
  }, [
    droneId, sessionDroneId, sessionId, applyAutoVerdicts, version, tick, battery, knownCellCount,
    gpsBuf, ekfBuf, sysStatusBuf, missionOnVehicle, fenceOnVehicle, tFix,
  ]);

  return null;
}
