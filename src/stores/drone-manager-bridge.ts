/**
 * @module drone-manager-bridge
 * @description Bridge protocol telemetry callbacks into Zustand stores.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import { useTelemetryStore } from "./telemetry-store";
import { useDroneStore } from "./drone-store";
import { useFleetStore } from "./fleet-store";
import { useSettingsStore } from "./settings-store";
import { useTrailStore } from "./trail-store";
import { audioEngine } from "@/lib/audio-engine";
import { useDiagnosticsStore } from "./diagnostics-store";
import { useGeofenceStore } from "./geofence-store";
import { useCanMonitorStore } from "./can-monitor-store";
import type { FlightMode } from "@/lib/types";

/** Known flight modes that map cleanly to the UI FlightMode union. */
const KNOWN_MODES: Set<string> = new Set([
  "STABILIZE", "ALT_HOLD", "LOITER", "GUIDED", "AUTO", "RTL", "LAND",
  "MANUAL", "ACRO",
  "FBWA", "FBWB", "CRUISE", "TRAINING", "CIRCLE", "AUTOTUNE",
  "QSTABILIZE", "QHOVER", "QLOITER", "QLAND", "QRTL",
  "POSHOLD", "BRAKE", "SMART_RTL", "DRIFT", "SPORT",
  "AVOID_ADSB", "THERMAL", "QAUTOTUNE", "QACRO", "FLIP", "THROW",
  "FLOWHOLD", "FOLLOW", "ZIGZAG", "SYSTEMID", "HELI_AUTOROTATE", "AUTO_RTL",
  "TAKEOFF", "LOITER_TO_QLAND",
]);

/**
 * Bridge protocol telemetry callbacks into the Zustand stores
 * (telemetry, drone, fleet). Returns an array of unsubscribe functions.
 */
export function bridgeTelemetry(
  droneId: string,
  protocol: DroneProtocol,
): (() => void)[] {
  const telemetry = useTelemetryStore.getState();
  const fleetStore = useFleetStore.getState();

  return [
    protocol.onAttitude((data) => telemetry.pushAttitude(data)),

    protocol.onPosition((data) => {
      telemetry.pushPosition(data);
      fleetStore.updateDrone(droneId, { position: data });
      useTrailStore.getState().pushPoint(data.lat, data.lon, data.relativeAlt);
    }),

    protocol.onBattery((data) => {
      telemetry.pushBattery(data);
      fleetStore.updateDrone(droneId, { battery: data });
    }),

    protocol.onGps((data) => {
      telemetry.pushGps(data);
      fleetStore.updateDrone(droneId, { gps: data });

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertGpsLost && data.fixType <= 1) {
        audioEngine.play("gps_lost");
      }
    }),

    protocol.onVfr((data) => telemetry.pushVfr(data)),

    protocol.onRc((data) => {
      telemetry.pushRc(data);

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertRcLost && data.rssi === 0) {
        audioEngine.play("rc_lost");
      }
    }),

    protocol.onSysStatus((data) => {
      telemetry.pushSysStatus(data);

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertLowBattery) {
        if (data.batteryRemaining >= 0 && data.batteryRemaining < settings.batteryCriticalPct) {
          audioEngine.play("low_battery");
        }
      }
    }),

    protocol.onRadio((data) => {
      telemetry.pushRadio(data);
    }),

    protocol.onEkf((data) => telemetry.pushEkf(data)),
    protocol.onVibration((data) => telemetry.pushVibration(data)),
    protocol.onServoOutput((data) => telemetry.pushServoOutput(data)),
    protocol.onWind((data) => telemetry.pushWind(data)),
    protocol.onTerrain((data) => telemetry.pushTerrain(data)),

    // Optional telemetry callbacks (bridged with optional chaining)
    ...(protocol.onScaledImu ? [protocol.onScaledImu((data) => telemetry.pushScaledImu(data))] : []),
    ...(protocol.onHomePosition ? [protocol.onHomePosition((data) => telemetry.pushHomePosition(data))] : []),
    ...(protocol.onPowerStatus ? [protocol.onPowerStatus((data) => telemetry.pushPowerStatus(data))] : []),
    ...(protocol.onDistanceSensor ? [protocol.onDistanceSensor((data) => telemetry.pushDistanceSensor(data))] : []),
    ...(protocol.onFenceStatus ? [protocol.onFenceStatus((data) => {
      telemetry.pushFenceStatus(data);
      useGeofenceStore.getState().updateBreachState(data.breachStatus, data.breachCount, data.breachType);
    })] : []),
    ...(protocol.onEstimatorStatus ? [protocol.onEstimatorStatus((data) => telemetry.pushEstimatorStatus(data))] : []),
    ...(protocol.onCameraTrigger ? [protocol.onCameraTrigger((data) => telemetry.pushCameraTrigger(data))] : []),
    ...(protocol.onNavController ? [protocol.onNavController((data) => telemetry.pushNavController(data))] : []),
    ...(protocol.onLocalPosition ? [protocol.onLocalPosition((data) => telemetry.pushLocalPosition(data))] : []),
    ...(protocol.onDebug ? [protocol.onDebug((data) => telemetry.pushDebug(data))] : []),
    ...(protocol.onGimbalAttitude ? [protocol.onGimbalAttitude((data) => telemetry.pushGimbal(data))] : []),
    ...(protocol.onObstacleDistance ? [protocol.onObstacleDistance((data) => telemetry.pushObstacle(data))] : []),
    ...(protocol.onCanFrame ? [protocol.onCanFrame((data) => {
      useCanMonitorStore.getState().pushFrame({
        timestamp: data.timestamp,
        bus: data.bus,
        id: data.id,
        len: data.len,
        data: data.data,
      });
    })] : []),

    protocol.onMissionProgress((data) => {
      if (data.reachedSeq !== undefined) {
        const settings = useSettingsStore.getState();
        if (settings.audioEnabled && settings.alertWaypoint) {
          audioEngine.play("waypoint_reached");
        }
      }
    }),

    protocol.onHeartbeat((data) => {
      const droneStore = useDroneStore.getState();

      const wasArmed = droneStore.armState === "armed";

      const mode = KNOWN_MODES.has(data.mode)
        ? (data.mode as FlightMode)
        : droneStore.flightMode;

      const prevMode = droneStore.flightMode;

      droneStore.setFlightMode(mode);
      droneStore.setArmState(data.armed ? "armed" : "disarmed");
      droneStore.setConnectionState(data.armed ? "armed" : "connected");
      droneStore.heartbeat();

      if (data.armed && !wasArmed) {
        useDiagnosticsStore.getState().logEvent("arm", "Vehicle armed");
      }
      if (!data.armed && wasArmed) {
        useDiagnosticsStore.getState().logEvent("disarm", "Vehicle disarmed");
      }

      if (mode !== prevMode) {
        useDiagnosticsStore.getState().logEvent("mode_change", `Mode: ${prevMode} → ${mode}`);
      }

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertArmDisarm) {
        if (data.armed && !wasArmed) audioEngine.play("arm");
        if (!data.armed && wasArmed) audioEngine.play("disarm");
      }

      droneStore.setSystemStatus(data.systemStatus);

      if (data.vehicleInfo) {
        droneStore.setFirmwareInfo(
          data.vehicleInfo.firmwareVersionString,
          data.vehicleInfo.vehicleClass,
        );
      }

      fleetStore.updateDrone(droneId, {
        status: data.armed ? "in_mission" : "online",
        connectionState: data.armed ? "armed" : "connected",
        flightMode: mode,
        armState: data.armed ? "armed" : "disarmed",
        lastHeartbeat: Date.now(),
      });
    }),
  ];
}
