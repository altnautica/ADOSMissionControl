"use client";

/**
 * @module ChecklistAutoRunner
 * @description Keeps the pre-flight checklist live for the selected drone.
 *
 * Mounted once by the shell, so the items follow telemetry whether or not a
 * checklist is open: the spec checklist that gates the first arm and the
 * detailed auto items are re-evaluated on every telemetry push and on the
 * shared 1 Hz clock, and an item whose telemetry goes stale falls back. It
 * also opens the session for whichever drone is selected; `selectDrone`
 * resets the session on a switch, so a checklist never carries from one
 * aircraft to another. Renders nothing.
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
import { useThrottledTelemetryVersion } from "@/hooks/use-throttled-telemetry-version";
import { useKnownCellCount } from "@/hooks/use-known-cell-count";
import { useFenceUploadStatus, useMissionUploadStatus } from "@/hooks/use-upload-status";
import { evaluateAutoChecks } from "@/lib/checklist/auto-checks";
import { isSkillLinkFresh } from "@/lib/skills/registry";
import { usePilotState } from "@/lib/cockpit/use-pilot-state";
import { usePadStatusStore } from "@/lib/input/pad-status";
import { useDroneStore } from "@/stores/drone-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { usePrearmBufferStore } from "@/stores/prearm-buffer-store";
import { useNavSource } from "@/hooks/use-nav-source";
import { shortPadName } from "@/lib/input/pad-status";
import { batteryLowPct, batteryReading } from "@/lib/hud/battery";
import { decodeSensorHealth } from "@/lib/sensor-health";
import { freshOnly } from "@/lib/telemetry/freshness";
import { fcPrearmTexts, preflightItems } from "@/lib/cockpit/preflight";

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
  const setPreflightItems = useChecklistStore((s) => s.setPreflightItems);

  // The throttled `_version` says new telemetry arrived (at most 4 Hz, so the
  // shell does not re-render per frame); the clock tick says time passed,
  // which is the only signal left once a link goes quiet.
  const version = useThrottledTelemetryVersion();
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
  const { pilot } = usePilotState(droneId);
  const lastHeartbeat = useDroneStore((s) => s.lastHeartbeat);
  const padUsable = usePadStatusStore((s) => s.connected && s.usable);
  const padName = usePadStatusStore((s) => s.name);
  const diskPercent = useAgentSystemStore((s) => s.resources?.disk_percent ?? null);
  const prearmLines = usePrearmBufferStore((s) => (droneId ? s.buffers[droneId] : undefined));
  const nav = useNavSource(droneId).result;

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
          pilot: pilot ? { readiness: pilot.readiness, controlMode: pilot.controlMode } : null,
          linkFresh: lastHeartbeat > 0 ? isSkillLinkFresh(lastHeartbeat, Date.now()) : null,
          controllerConnected: padUsable,
          diskPercent,
        },
        Date.now(),
      ),
    );
  }, [
    droneId, sessionDroneId, sessionId, applyAutoVerdicts, version, tick, battery, knownCellCount,
    gpsBuf, ekfBuf, sysStatusBuf, missionOnVehicle, fenceOnVehicle, tFix,
    pilot, lastHeartbeat, padUsable, diskPercent,
  ]);

  // The spec checklist that gates the first arm.
  useEffect(() => {
    if (!droneId || sessionDroneId !== droneId) return;
    const now = Date.now();
    const sysStatus = freshOnly(sysStatusBuf.latest(), now);
    const prearmBit = sysStatus ? decodeSensorHealth(sysStatus).find((s) => s.name === "pre_arm_check") : undefined;
    const fcBattery = freshOnly(battery, now);
    setPreflightItems(
      droneId,
      preflightItems({
        readiness: pilot?.readiness ?? [],
        prearm: fcPrearmTexts({
          pilotStatustext: pilot?.statustext ?? null,
          sysStatusPrearmOk: prearmBit?.present ? prearmBit.healthy : null,
          directLines: prearmLines ?? [],
        }),
        live: lastHeartbeat > 0 && isSkillLinkFresh(lastHeartbeat, now),
        nav,
        battery: batteryReading(null, fcBattery ? { battery: { remaining: fcBattery.remaining, voltage: fcBattery.voltage } } : null),
        batteryLowPct: batteryLowPct(null),
        controlMode: pilot?.controlMode ?? null,
        controller: { connected: padUsable, name: shortPadName(padName) },
        storagePct: diskPercent,
      }),
    );
  }, [
    droneId, sessionDroneId, sessionId, setPreflightItems, version, tick, battery, sysStatusBuf,
    pilot, prearmLines, lastHeartbeat, nav, padUsable, padName, diskPercent,
  ]);

  return null;
}
