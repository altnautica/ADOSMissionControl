/**
 * @module drone-manager-bridge
 * @description Bridge protocol telemetry callbacks into Zustand stores.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import { useTelemetryStore, computeVioQuality } from "./telemetry-store";
import { useDroneStore } from "./drone-store";
import { useNodeRegistryStore } from "./node-registry";
import { useSettingsStore } from "./settings-store";
import { useTrailStore } from "./trail-store";
import { audioEngine } from "@/lib/audio-engine";
import { useDiagnosticsStore } from "./diagnostics-store";
import { useGeofenceStore } from "./geofence-store";
import { useCanMonitorStore } from "./can-monitor-store";
import { recordFrameFor } from "@/lib/telemetry-recorder";
import { notifyArmed } from "@/lib/flight-lifecycle";
import { usePrearmBufferStore } from "@/stores/prearm-buffer-store";
import { asFlightMode } from "@/lib/flight-mode";

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
  const registry = useNodeRegistryStore.getState();

  /**
   * The telemetry-store ring buffers are a single set of slots shared across
   * every connected drone (charts read the selected drone's live history from
   * them). Only the selected drone may write into them, otherwise a second
   * connected drone's frames interleave into the same attitude/position/battery
   * rings. Fleet-store updates and the per-drone recorder stay ungated below —
   * those are keyed by droneId and correctly per-drone. The drone-manager keeps
   * the singleton store in sync with selection by clearing it on switch.
   */
  const isSelected = () => useDroneStore.getState().selectedId === droneId;

  /** Record a frame to the recorder slot for this drone. Noop if no recording is active. */
  const rec = (channel: string, data: unknown) => recordFrameFor(droneId, channel, data);

  return [
    protocol.onAttitude((data) => {
      if (isSelected()) telemetry.pushAttitude(data);
      rec("attitude", data);
    }),

    protocol.onPosition((data) => {
      if (isSelected()) telemetry.pushPosition(data);
      // Flight telemetry mirrors into the node registry (the single fleet
      // identity write target); the projection turns it into the fleet row.
      // The data is already in degrees — the registry is a pass-through mirror.
      registry.updateFcTelemetry(droneId, { position: data });
      useTrailStore.getState().pushPoint(data.lat, data.lon, data.relativeAlt);
      rec("position", data);
    }),

    protocol.onBattery((data) => {
      if (isSelected()) telemetry.pushBattery(data);
      registry.updateFcTelemetry(droneId, { battery: data });
      rec("battery", data);
    }),

    protocol.onGps((data) => {
      if (isSelected()) telemetry.pushGps(data);
      registry.updateFcTelemetry(droneId, { gps: data });
      rec("gps", data);

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertGpsLost && data.fixType <= 1) {
        audioEngine.play("gps_lost");
      }
    }),

    protocol.onVfr((data) => {
      if (isSelected()) telemetry.pushVfr(data);
      rec("vfr", data);
    }),

    protocol.onRc((data) => {
      if (isSelected()) telemetry.pushRc(data);
      rec("rc", data);

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertRcLost && data.rssi === 0) {
        audioEngine.play("rc_lost");
      }
    }),

    protocol.onSysStatus((data) => {
      if (isSelected()) telemetry.pushSysStatus(data);
      rec("sysStatus", data);

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertLowBattery) {
        if (data.batteryRemaining >= 0 && data.batteryRemaining < settings.batteryCriticalPct) {
          audioEngine.play("low_battery");
        }
      }
    }),

    protocol.onRadio((data) => {
      if (isSelected()) telemetry.pushRadio(data);
      rec("radio", data);
    }),

    protocol.onEkf((data) => {
      if (isSelected()) telemetry.pushEkf(data);
      rec("ekf", data);
    }),
    protocol.onVibration((data) => {
      if (isSelected()) telemetry.pushVibration(data);
      rec("vibration", data);
    }),
    protocol.onServoOutput((data) => {
      if (isSelected()) telemetry.pushServoOutput(data);
      rec("servoOutput", data);
    }),
    protocol.onWind((data) => {
      if (isSelected()) telemetry.pushWind(data);
      rec("wind", data);
    }),
    protocol.onTerrain((data) => {
      if (isSelected()) telemetry.pushTerrain(data);
      rec("terrain", data);
    }),

    // Optional telemetry callbacks (bridged with optional chaining)
    ...(protocol.onScaledImu ? [protocol.onScaledImu((data) => {
      if (isSelected()) telemetry.pushScaledImu(data);
      rec("scaledImu", data);
    })] : []),
    ...(protocol.onHomePosition ? [protocol.onHomePosition((data) => {
      if (isSelected()) telemetry.pushHomePosition(data);
      rec("homePosition", data);
    })] : []),
    ...(protocol.onPowerStatus ? [protocol.onPowerStatus((data) => {
      if (isSelected()) telemetry.pushPowerStatus(data);
      rec("powerStatus", data);
    })] : []),
    ...(protocol.onDistanceSensor ? [protocol.onDistanceSensor((data) => {
      if (isSelected()) telemetry.pushDistanceSensor(data);
      rec("distanceSensor", data);
    })] : []),
    ...(protocol.onFenceStatus ? [protocol.onFenceStatus((data) => {
      if (isSelected()) telemetry.pushFenceStatus(data);
      useGeofenceStore.getState().updateBreachState(data.breachStatus, data.breachCount, data.breachType);
      rec("fenceStatus", data);
    })] : []),
    ...(protocol.onEstimatorStatus ? [protocol.onEstimatorStatus((data) => {
      if (isSelected()) telemetry.pushEstimatorStatus(data);
      rec("estimatorStatus", data);
    })] : []),
    ...(protocol.onCameraTrigger ? [protocol.onCameraTrigger((data) => {
      if (isSelected()) telemetry.pushCameraTrigger(data);
      rec("cameraTrigger", data);
    })] : []),
    ...(protocol.onNavController ? [protocol.onNavController((data) => {
      if (isSelected()) telemetry.pushNavController(data);
      rec("navController", data);
    })] : []),
    ...(protocol.onLocalPosition ? [protocol.onLocalPosition((data) => {
      if (isSelected()) telemetry.pushLocalPosition(data);
      rec("localPosition", data);
    })] : []),
    ...(protocol.onDebug ? [protocol.onDebug((data) => {
      if (isSelected()) telemetry.pushDebug(data);
      rec("debug", data);
    })] : []),
    ...(protocol.onGimbalAttitude ? [protocol.onGimbalAttitude((data) => {
      if (isSelected()) telemetry.pushGimbal(data);
      rec("gimbal", data);
    })] : []),
    ...(protocol.onObstacleDistance ? [protocol.onObstacleDistance((data) => {
      if (isSelected()) telemetry.pushObstacle(data);
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

    // Vision-navigation quality channels. The plugin-side emitter
    // for these MAVLink messages may not be active; ring buffers
    // stay empty when no data flows.
    ...(protocol.onOpticalFlowRad ? [protocol.onOpticalFlowRad((data) => {
      const ts = Date.now();
      if (isSelected()) {
        const t = useTelemetryStore.getState();
        t.pushFlowQuality(ts, data.quality);
        // OPTICAL_FLOW_RAD reserves a sentinel when distance is unknown.
        // The decoded payload may surface this as a non-finite or negative
        // value; coerce that into null so consumers can mark "no data".
        const d = data.distance;
        const known = Number.isFinite(d) && d >= 0;
        t.pushFlowDistance(ts, known ? d : null);
      }
      rec("opticalFlowRad", data);
    })] : []),
    ...(protocol.onOdometry ? [protocol.onOdometry((data) => {
      const ts = Date.now();
      if (isSelected()) {
        const q = data.quality ?? computeVioQuality(data.poseCovariance);
        useTelemetryStore.getState().pushVioQuality(ts, q);
      }
      rec("odometry", data);
    })] : []),

    // capture ArduPilot prearm STATUSTEXT lines into a per-drone
    // ring buffer that the flight lifecycle drains on arm.
    protocol.onStatusText((data) => {
      usePrearmBufferStore.getState().push(droneId, data.text);
    }),

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

      const mode = asFlightMode(data.mode) ?? droneStore.flightMode;

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

      // per-drone flight lifecycle. Snapshot last-known position so
      // the draft FlightRecord gets takeoff/landing coords. Read from the
      // per-node registry FC sub-state rather than the shared singleton
      // telemetry ring — the ring only holds the selected drone's history, so a
      // heartbeat from a non-selected drone would otherwise pick up the wrong
      // coordinates.
      const lastPos = useNodeRegistryStore.getState().getEntry(droneId)?.fc.position;
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

      // Flight-state mirrors into the registry FC sub-state. The projection
      // derives the fleet row's status / connectionState / arm / mode from it,
      // FC-gated, so a cloud presence tick can never overwrite live flight
      // state and an FC-less node never shows a fabricated reading.
      registry.updateFcTelemetry(droneId, {
        flightMode: mode,
        armState: data.armed ? "armed" : "disarmed",
        status: data.armed ? "in_mission" : "online",
        lastHeartbeat: Date.now(),
      });
    }),
  ];
}
