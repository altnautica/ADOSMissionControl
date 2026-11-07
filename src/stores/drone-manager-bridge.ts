/**
 * @module drone-manager-bridge
 * @description Bridge protocol telemetry callbacks into Zustand stores.
 * @license GPL-3.0-only
 */

import type { DroneProtocol } from "@/lib/protocol/types";
import { useDroneManager } from "./drone-manager";
import type { SysStatusData } from "@/lib/types";
import { useTelemetryStore, computeVioQuality } from "./telemetry-store";
import { useDroneStore } from "./drone-store";
import { droneSelection } from "./drone-selection";
import { useNodeRegistryStore } from "./node-registry";
import { useSettingsStore } from "./settings-store";
import { useTrailStore } from "./trail-store";
import { audioEngine } from "@/lib/audio-engine";
import { isFailsafeAnnouncement } from "@/lib/telemetry/failsafe-text";
import { knownRemainingPct } from "@/lib/battery";
import { useDiagnosticsStore } from "./diagnostics-store";
import { useGeofenceStore } from "./geofence-store";
import { useCanMonitorStore } from "./can-monitor-store";
import { useGpsOriginStore } from "./gps-origin-store";
import { recordFrameFor } from "@/lib/telemetry-recorder";
import { notifyArmed } from "@/lib/flight-lifecycle";
import { usePrearmBufferStore } from "@/stores/prearm-buffer-store";
import { asFlightMode } from "@/lib/flight-mode";
import { useMissionStore } from "./mission-store";
import { createFleetAlertProducer } from "@/lib/fleet-alerts";
import { createAdsbTrafficTable } from "@/lib/telemetry/adsb-traffic";
import { useMissionStateStore } from "@/lib/mission/mission-state";

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
   *
   * The gate reads `drone-manager.selectedDroneId`, which is the ONE owner of
   * selection. It used to read a `drone-store.selectedId` mirror that the
   * manager only sometimes updated (`selectDrone(null)` and `clear()` both
   * skipped it), so the gate could pass for a drone the operator had already
   * switched away from — the exact interleave it exists to prevent.
   *
   * The selection is read through the `drone-selection` leaf, which the
   * manager binds at creation, so this module never imports the manager that
   * imports it.
   */
  const isSelected = () => droneSelection().selectedDroneId === droneId;

  /** Record a frame to the recorder slot for this drone. Noop if no recording is active. */
  const rec = (channel: string, data: unknown) => recordFrameFor(droneId, channel, data);

  /** Fleet alerts (Dashboard counts and feed) raised from this drone's frames. */
  const alerts = createFleetAlertProducer(droneId, droneName);

  /** This drone's latest SYS_STATUS, frozen into its flight record at arm. */
  let latestSysStatus: SysStatusData | undefined;

  /**
   * A plain telemetry channel: the selected drone's frames feed the shared
   * ring, every drone's frames are recorded. Null when the protocol does not
   * offer the channel.
   */
  function plainChannel<T>(
    subscribe: ((callback: (data: T) => void) => () => void) | undefined,
    push: (data: T) => void,
    channel: string,
  ): (() => () => void) | null {
    if (!subscribe) return null;
    return () =>
      subscribe((data) => {
        if (isSelected()) push(data);
        rec(channel, data);
      });
  }

  const plainChannels = [
    plainChannel(protocol.onAttitude.bind(protocol), telemetry.pushAttitude, "attitude"),
    plainChannel(protocol.onVfr.bind(protocol), telemetry.pushVfr, "vfr"),
    plainChannel(protocol.onRadio.bind(protocol), telemetry.pushRadio, "radio"),
    plainChannel(protocol.onEkf.bind(protocol), telemetry.pushEkf, "ekf"),
    plainChannel(protocol.onVibration.bind(protocol), telemetry.pushVibration, "vibration"),
    plainChannel(protocol.onServoOutput.bind(protocol), telemetry.pushServoOutput, "servoOutput"),
    plainChannel(protocol.onWind.bind(protocol), telemetry.pushWind, "wind"),
    plainChannel(protocol.onTerrain.bind(protocol), telemetry.pushTerrain, "terrain"),
    plainChannel(protocol.onHomePosition?.bind(protocol), telemetry.pushHomePosition, "homePosition"),
    plainChannel(protocol.onPowerStatus?.bind(protocol), telemetry.pushPowerStatus, "powerStatus"),
    plainChannel(protocol.onDistanceSensor?.bind(protocol), telemetry.pushDistanceSensor, "distanceSensor"),
    plainChannel(protocol.onEstimatorStatus?.bind(protocol), telemetry.pushEstimatorStatus, "estimatorStatus"),
    plainChannel(protocol.onCameraTrigger?.bind(protocol), telemetry.pushCameraTrigger, "cameraTrigger"),
    plainChannel(protocol.onNavController?.bind(protocol), telemetry.pushNavController, "navController"),
    plainChannel(protocol.onLocalPosition?.bind(protocol), telemetry.pushLocalPosition, "localPosition"),
    plainChannel(protocol.onDebug?.bind(protocol), telemetry.pushDebug, "debug"),
    plainChannel(protocol.onGimbalAttitude?.bind(protocol), telemetry.pushGimbal, "gimbal"),
    plainChannel(protocol.onObstacleDistance?.bind(protocol), telemetry.pushObstacle, "obstacle"),
  ];

  return [
    ...plainChannels.flatMap((bind) => (bind ? [bind()] : [])),

    protocol.onPosition((data) => {
      if (isSelected()) {
        telemetry.pushPosition(data);
        // The trail ring is a single global set of slots, exactly like the
        // telemetry rings, so it belongs inside the same gate. Ungated, two
        // connected drones interleaved their position streams into one ring
        // and `TelemetryStrip` read `_ring.get(0)` as "home" — which would be
        // whichever drone happened to report first.
        useTrailStore.getState().pushPoint(data.lat, data.lon, data.relativeAlt);
      }
      // Flight telemetry mirrors into the node registry (the single fleet
      // identity write target); the projection turns it into the fleet row.
      // The data is already in degrees — the registry is a pass-through mirror.
      registry.updateFcTelemetry(droneId, { position: data });
      rec("position", data);
    }),

    protocol.onBattery(({ id, ...data }) => {
      // Every configured monitor sends its own BATTERY_STATUS. Only the
      // primary pack (id 0) feeds the single-battery surfaces and the
      // "battery" record channel; other monitors record under their own
      // channel so packs never interleave into one stream.
      if (id !== 0) {
        rec(`battery${id + 1}`, data);
        return;
      }
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
      latestSysStatus = data;
      rec("sysStatus", data);
      alerts.batteryRemaining(data.batteryRemaining);

      const settings = useSettingsStore.getState();
      const remaining = knownRemainingPct(data.batteryRemaining);
      if (settings.audioEnabled && settings.alertLowBattery && remaining !== null) {
        if (remaining < settings.batteryCriticalPct) {
          audioEngine.play("low_battery");
        }
      }
    }),

    // Optional telemetry callbacks (bridged with optional chaining)
    // The shared buffer and recording carry the primary IMU only; SCALED_IMU2/3
    // would interleave other sensors' readings into one series. Per-instance
    // views subscribe to the protocol directly.
    ...(protocol.onScaledImu ? [protocol.onScaledImu((data) => {
      if (data.imu !== 0) return;
      if (isSelected()) telemetry.pushScaledImu(data);
      rec("scaledImu", data);
    })] : []),
    // AUTOPILOT_VERSION carries the board id and firmware version after the
    // handshake; stamp them on the managed drone so a reconnect compares the
    // full identity.
    ...(protocol.onAutopilotVersion ? [protocol.onAutopilotVersion((data) => {
      const v = data.flightSwVersion;
      useDroneManager.getState().updateVehicleIdentity(droneId, {
        boardId: data.boardId,
        firmwareVersionString: `${(v >> 24) & 0xff}.${(v >> 16) & 0xff}.${(v >> 8) & 0xff}`,
      });
    })] : []),
    ...(protocol.onFenceStatus ? [protocol.onFenceStatus((data) => {
      // Single-slot breach state, so it belongs inside the selection gate like
      // every other singleton push here. Ungated, a FENCE_STATUS from ANY
      // connected drone raised `CornerAlerts` for
      // whichever drone the operator was watching.
      if (isSelected()) {
        telemetry.pushFenceStatus(data);
        useGeofenceStore.getState().updateBreachState(data.breachStatus, data.breachCount, data.breachType);
      }
      rec("fenceStatus", data);
    })] : []),
    ...(protocol.onAdsbVehicle ? (() => {
      // The traffic list is a single store slot, so only the selected drone
      // publishes into it, like the telemetry rings above.
      const traffic = createAdsbTrafficTable((vehicles) => {
        if (isSelected()) useTelemetryStore.getState().setAdsbVehicles(vehicles);
      });
      return [protocol.onAdsbVehicle((contact) => traffic.update(contact)), () => traffic.dispose()];
    })() : []),
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
        // `-1` is MAVLink's "odometry has failed", not a quality score: it
        // must reach the surface as 0 (worst), never as 255 or as a fallback.
        const q =
          data.quality === undefined
            ? computeVioQuality(data.poseCovariance)
            : Math.max(0, data.quality);
        useTelemetryStore.getState().pushVioQuality(ts, q);
      }
      rec("odometry", data);
    })] : []),

    // capture ArduPilot prearm STATUSTEXT lines into a per-drone
    // ring buffer that the flight lifecycle drains on arm.
    protocol.onStatusText((data) => {
      usePrearmBufferStore.getState().push(droneId, data.text);
      alerts.statusText(data.severity, data.text);

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertFailsafe && isFailsafeAnnouncement(data.severity, data.text)) {
        audioEngine.play("failsafe");
      }
    }),

    protocol.onMissionProgress((data) => {
      if (data.reachedSeq !== undefined) {
        useMissionStateStore.getState().observe(droneId, { itemReached: data.reachedSeq });
        const settings = useSettingsStore.getState();
        if (settings.audioEnabled && settings.alertWaypoint) {
          audioEngine.play("waypoint_reached");
        }
      } else {
        // The FC's own count when it sends one; an older FC sends none, so the
        // plan this GCS holds stands in for the mirror.
        const total = data.total ?? (isSelected() ? useMissionStore.getState().waypoints.length : 0);
        useMissionStateStore.getState().observe(droneId, {
          seq: data.currentSeq,
          total,
          missionState: data.missionState ?? null,
          missionCurrentAt: Date.now(),
          id: data.missionId ?? null,
        });
      }
      if (data.reachedSeq === undefined && isSelected()) {
        // MISSION_CURRENT: the item the FC is flying now. mission-store is a
        // single slot for the selected drone, and maps the seq onto the plan
        // only when this drone's upload receipt matches it.
        useMissionStore.getState().applyMissionCurrent(droneId, data.currentSeq);
      }
    }),

    protocol.onHeartbeat((data) => {
      const droneStore = useDroneStore.getState();
      useMissionStateStore.getState().observe(droneId, {
        armed: data.armed,
        customMode: data.customMode ?? null,
        firmware: data.vehicleInfo?.firmwareType,
      });

      // Previous arm state and mode come from THIS drone's registry entry, not
      // from the single-slot drone-store: the store holds the selected drone
      // only, so deriving arm/disarm and mode-change events from it attributed
      // one drone's transitions to another. Across a lost link the previous
      // state is "unknown": the first heartbeat back reports where the
      // aircraft is, not a transition anyone observed, so it raises no
      // arm/disarm event or sound.
      const prevEntry = useNodeRegistryStore.getState().getEntry(droneId)?.fc;
      const prevArm = prevEntry?.armState;
      const armedNow = data.armed && prevArm !== "armed" && prevArm !== "unknown";
      const disarmedNow = !data.armed && prevArm === "armed";
      const prevMode = prevEntry?.flightMode;

      // A mode outside the union is reported as UNKNOWN, never as the last
      // known mode: a stale mode name reads as a confirmed vehicle state.
      const mode = asFlightMode(data.mode) ?? "UNKNOWN";

      // drone-store is a single slot scoped to the operator's selection. Every
      // other push in this bridge is gated on `isSelected()`; this handler was
      // not, so every connected drone's heartbeat overwrote the selected
      // drone's arm state, mode, system status and firmware info.
      if (isSelected()) {
        droneStore.setFlightMode(mode);
        droneStore.setArmState(data.armed ? "armed" : "disarmed");
        droneStore.setConnectionState(data.armed ? "armed" : "connected");
        droneStore.heartbeat();
        droneStore.setSystemStatus(data.systemStatus);
        if (data.vehicleInfo) {
          droneStore.setFirmwareInfo(
            data.vehicleInfo.firmwareVersionString,
            data.vehicleInfo.vehicleClass,
          );
        }
      }

      if (armedNow) {
        useDiagnosticsStore.getState().logEvent("arm", "Vehicle armed");
      }
      if (disarmedNow) {
        useDiagnosticsStore.getState().logEvent("disarm", "Vehicle disarmed");
      }

      // per-drone flight lifecycle. Snapshot last-known position so
      // the draft FlightRecord gets takeoff/landing coords. Read from the
      // per-node registry FC sub-state rather than the shared singleton
      // telemetry ring — the ring only holds the selected drone's history, so a
      // heartbeat from a non-selected drone would otherwise pick up the wrong
      // coordinates.
      const lastPos = prevEntry?.position;
      notifyArmed(droneId, droneName, data.armed, {
        lat: lastPos?.lat,
        lon: lastPos?.lon,
        gpsFixType: prevEntry?.gps?.fixType,
        sysStatus: latestSysStatus,
        selected: isSelected(),
      });

      if (prevMode !== undefined && mode !== prevMode) {
        useDiagnosticsStore.getState().logEvent("mode_change", `Mode: ${prevMode} → ${mode}`);
      }

      const settings = useSettingsStore.getState();
      if (settings.audioEnabled && settings.alertArmDisarm) {
        if (armedNow) audioEngine.play("arm");
        if (disarmedNow) audioEngine.play("disarm");
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

    // Link-loss decay. On a link that goes silent while the transport stays
    // open (UDP-listen, an MQTT relay, the agent's WS proxy with a dead FC
    // serial link, an SiK radio whose USB port stays enumerated) the last
    // heartbeat's ARMED / CONNECTED would otherwise persist forever. The arm
    // state becomes "unknown", never "disarmed": an aircraft that stops
    // talking may still be flying, and a disarmed reading would offer an ARM
    // button and drop it from every armed-fleet surface. `useArmedLock()`
    // treats unknown as unlocked, so the FC panels of a gone vehicle unlock.
    ...(protocol.onLinkLost ? [protocol.onLinkLost(() => {
      if (isSelected()) {
        const droneStore = useDroneStore.getState();
        droneStore.setConnectionState("disconnected");
        droneStore.setArmState("unknown");
      }
      registry.updateFcTelemetry(droneId, { status: "offline", armState: "unknown" });
      useDiagnosticsStore.getState().logEvent("link_lost", `Link lost: ${droneName}`);
      alerts.linkLost();
    })] : []),

    ...(protocol.onLinkRestored ? [protocol.onLinkRestored(() => {
      if (isSelected()) {
        useDroneStore.getState().setConnectionState("connected");
      }
      registry.updateFcTelemetry(droneId, { status: "online" });
      useDiagnosticsStore.getState().logEvent("link_restored", `Link restored: ${droneName}`);
      alerts.linkRestored();
    })] : []),

    // The EKF origin is kept per drone (it is sent rarely, so a drone selected
    // later still needs it) and dropped with this bridge.
    ...(protocol.onGpsOrigin ? [
      protocol.onGpsOrigin((data) => useGpsOriginStore.getState().setOrigin(droneId, data)),
      () => useGpsOriginStore.getState().clear(droneId),
    ] : []),
  ];
}
