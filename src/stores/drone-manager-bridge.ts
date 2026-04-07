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
import { recordFrameFor } from "@/lib/telemetry-recorder";
import { notifyArmed } from "@/lib/flight-lifecycle";
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
  droneName: string,
  protocol: DroneProtocol,
): (() => void)[] {
  const telemetry = useTelemetryStore.getState();
  const fleetStore = useFleetStore.getState();

  /** Record a frame to the recorder slot for this drone (Phase 1). Noop if no recording is active. */
  const rec = (channel: string, data: unknown) => recordFrameFor(droneId, channel, data);

  return [
    protocol.onAttitude((data) => {
      telemetry.pushAttitude(data);
      rec("attitude", data);
    }),

    protocol.onPosition((data) => {
      telemetry.pushPosition(data);
      fleetStore.updateDrone(droneId, { position: data });
      useTrailStore.getState().pushPoint(data.lat, data.lon, data.relativeAlt);
      rec("position", data);
    }),

    protocol.onBattery((data) => {
      telemetry.pushBattery(data);
      fleetStore.updateDrone(droneId, { battery: data });
      rec("battery", data);
    }),

    protocol.onGps((data) => {
      telemetry.pushGps(data);
      fleetStore.updateDrone(droneId, { gps: data });
      rec("gps", data);

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertGpsLost && data.fixType <= 1) {
        audioEngine.play("gps_lost");
      }
    }),

    protocol.onVfr((data) => {
      telemetry.pushVfr(data);
      rec("vfr", data);
    }),

    protocol.onRc((data) => {
      telemetry.pushRc(data);
      rec("rc", data);

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertRcLost && data.rssi === 0) {
        audioEngine.play("rc_lost");
      }
    }),

    protocol.onSysStatus((data) => {
      telemetry.pushSysStatus(data);
      rec("sysStatus", data);

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertLowBattery) {
        if (data.batteryRemaining >= 0 && data.batteryRemaining < settings.batteryCriticalPct) {
          audioEngine.play("low_battery");
        }
      }
    }),

    protocol.onRadio((data) => {
      telemetry.pushRadio(data);
      rec("radio", data);
    }),

    protocol.onEkf((data) => {
      telemetry.pushEkf(data);
      rec("ekf", data);
    }),
    protocol.onVibration((data) => {
      telemetry.pushVibration(data);
      rec("vibration", data);
    }),
    protocol.onServoOutput((data) => {
      telemetry.pushServoOutput(data);
      rec("servoOutput", data);
    }),
    protocol.onWind((data) => {
      telemetry.pushWind(data);
      rec("wind", data);
    }),
    protocol.onTerrain((data) => {
      telemetry.pushTerrain(data);
      rec("terrain", data);
    }),

    // Optional telemetry callbacks (bridged with optional chaining)
    ...(protocol.onScaledImu ? [protocol.onScaledImu((data) => {
      telemetry.pushScaledImu(data);
      rec("scaledImu", data);
    })] : []),
    ...(protocol.onHomePosition ? [protocol.onHomePosition((data) => {
      telemetry.pushHomePosition(data);
      rec("homePosition", data);
    })] : []),
    ...(protocol.onPowerStatus ? [protocol.onPowerStatus((data) => {
      telemetry.pushPowerStatus(data);
      rec("powerStatus", data);
    })] : []),
    ...(protocol.onDistanceSensor ? [protocol.onDistanceSensor((data) => {
      telemetry.pushDistanceSensor(data);
      rec("distanceSensor", data);
    })] : []),
    ...(protocol.onFenceStatus ? [protocol.onFenceStatus((data) => {
      telemetry.pushFenceStatus(data);
      useGeofenceStore.getState().updateBreachState(data.breachStatus, data.breachCount, data.breachType);
      rec("fenceStatus", data);
    })] : []),
    ...(protocol.onEstimatorStatus ? [protocol.onEstimatorStatus((data) => {
      telemetry.pushEstimatorStatus(data);
      rec("estimatorStatus", data);
    })] : []),
    ...(protocol.onCameraTrigger ? [protocol.onCameraTrigger((data) => {
      telemetry.pushCameraTrigger(data);
      rec("cameraTrigger", data);
    })] : []),
    ...(protocol.onNavController ? [protocol.onNavController((data) => {
      telemetry.pushNavController(data);
      rec("navController", data);
    })] : []),
    ...(protocol.onLocalPosition ? [protocol.onLocalPosition((data) => {
      telemetry.pushLocalPosition(data);
      rec("localPosition", data);
    })] : []),
    ...(protocol.onDebug ? [protocol.onDebug((data) => {
      telemetry.pushDebug(data);
      rec("debug", data);
    })] : []),
    ...(protocol.onGimbalAttitude ? [protocol.onGimbalAttitude((data) => {
      telemetry.pushGimbal(data);
      rec("gimbal", data);
    })] : []),
    ...(protocol.onObstacleDistance ? [protocol.onObstacleDistance((data) => {
      telemetry.pushObstacle(data);
      rec("obstacle", data);
    })] : []),
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

      // Phase 2: per-drone flight lifecycle. Snapshot last-known position so
      // the draft FlightRecord gets takeoff/landing coords without an extra
      // ring-buffer roundtrip in the lifecycle module.
      const lastPos = telemetry.position.toArray().at(-1);
      notifyArmed(droneId, droneName, data.armed, {
        lat: lastPos?.lat,
        lon: lastPos?.lon,
      });

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
