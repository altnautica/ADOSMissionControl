/**
 * Mock engine telemetry emission helpers.
 *
 * Extracted from engine.ts — emits protocol-level telemetry
 * callbacks for the selected drone in demo mode.
 *
 * @license GPL-3.0-only
 */

import { FLIGHT_PATHS } from "./flight-paths";
import { generateStatusMessage } from "./status-messages";
import { useTelemetryStore } from "@/stores/telemetry-store";
import type { MockProtocol } from "./mock-protocol";
import type { FleetDrone } from "@/lib/types";
import type { UnifiedFlightMode } from "@/lib/protocol/types";

/** Core sensor bitmask: gyro | accel | compass | baro | GPS | motors | RC | AHRS | battery | pre-arm check */
export const SENSOR_MASK = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 5)
  | (1 << 15) | (1 << 16) | (1 << 21) | (1 << 25) | (1 << 28);

interface TelemetryTickContext {
  tickCount: number;
  protocol: MockProtocol;
  droneUpdate: Partial<FleetDrone>;
  pos: { lat: number; lon: number; alt: number; heading: number };
  roll: number;
  pitch: number;
  headingDelta: number;
  battery: number;
  pathIndex: number;
  currentWaypointIdx: number;
  pathProgress: number;
  segmentDistances: number[];
  status: string;
  flightMode: string;
  statusMessageTick: number;
  rcChannels: number[];
}

/**
 * Push ring-buffer telemetry and protocol-emitted telemetry
 * for the currently selected drone.
 */
export function emitSelectedDroneTelemetry(ctx: TelemetryTickContext): number {
  const telemetryStore = useTelemetryStore.getState();
  const now = Date.now();
  const path = FLIGHT_PATHS[ctx.pathIndex];
  const nextWp = path[(ctx.currentWaypointIdx + 1) % path.length];
  const wp = path[ctx.currentWaypointIdx];

  telemetryStore.pushBatch({
    attitude: {
      timestamp: now,
      roll: ctx.roll,
      pitch: ctx.pitch,
      yaw: ctx.pos.heading,
      rollSpeed: ctx.roll * 0.1,
      pitchSpeed: ctx.pitch * 0.05,
      yawSpeed: ctx.headingDelta * 0.02,
    },
    position: ctx.droneUpdate.position!,
    ...(ctx.tickCount % 3 === 0 ? { battery: ctx.droneUpdate.battery! } : {}),
    gps: ctx.droneUpdate.gps!,
    vfr: {
      timestamp: now,
      airspeed: wp.speed * 1.05,
      groundspeed: wp.speed,
      heading: ctx.pos.heading,
      throttle: 45 + Math.random() * 15,
      alt: ctx.pos.alt,
      climb: (nextWp.alt - wp.alt) * ctx.pathProgress,
    },
    rc: {
      timestamp: now,
      channels: ctx.rcChannels,
      rssi: 200 + Math.floor(Math.random() * 55),
    },
  });

  ctx.protocol.setRcChannelValues(ctx.rcChannels);

  // SysStatus at 1Hz (every 5 ticks at 5Hz tick rate)
  if (ctx.tickCount % 5 === 0) {
    ctx.protocol.emitSysStatus({
      timestamp: now,
      cpuLoad: 150 + Math.floor(Math.random() * 50),
      sensorsPresent: SENSOR_MASK,
      sensorsEnabled: SENSOR_MASK,
      sensorsHealthy: SENSOR_MASK,
      voltageMv: Math.round(ctx.droneUpdate.battery!.voltage * 1000),
      currentCa: Math.round((ctx.droneUpdate.battery!.current ?? 0) * 100),
      batteryRemaining: Math.round(ctx.battery),
      dropRateComm: 0,
      errorsComm: 0,
    });
  }

  // Radio at ~2Hz
  if (ctx.tickCount % 3 === 0) {
    ctx.protocol.emitRadio({
      timestamp: now,
      rssi: 180 + Math.floor(Math.random() * 40),
      remrssi: 170 + Math.floor(Math.random() * 40),
      txbuf: 95 + Math.floor(Math.random() * 5),
      noise: 30 + Math.floor(Math.random() * 10),
      remnoise: 32 + Math.floor(Math.random() * 10),
      rxerrors: 0,
      fixed: 0,
      sourceSystemId: 51,
    });
  }

  // EKF at 1Hz
  if (ctx.tickCount % 5 === 0) {
    ctx.protocol.emitEkf({
      timestamp: now,
      velocityVariance: 0.01 + Math.random() * 0.03,
      posHorizVariance: 0.02 + Math.random() * 0.04,
      posVertVariance: 0.01 + Math.random() * 0.02,
      compassVariance: 0.01 + Math.random() * 0.06,
      terrainAltVariance: 0.01 + Math.random() * 0.02,
      flags: 0x1FF,
    });
  }

  // Vibration at ~2Hz
  if (ctx.tickCount % 3 === 0) {
    ctx.protocol.emitVibration({
      timestamp: now,
      vibrationX: 5 + Math.random() * 10,
      vibrationY: 5 + Math.random() * 10,
      vibrationZ: 8 + Math.random() * 15,
      clipping0: 0, clipping1: 0, clipping2: 0,
    });
  }

  // Servo output at ~2Hz
  if (ctx.tickCount % 3 === 0) {
    const throttle = 45 + Math.random() * 15;
    const motorPwm = 1000 + Math.round(throttle * 10);
    ctx.protocol.emitServoOutput({
      timestamp: now, port: 0,
      servos: [
        motorPwm + Math.round((Math.random() - 0.5) * 20),
        motorPwm + Math.round((Math.random() - 0.5) * 20),
        motorPwm + Math.round((Math.random() - 0.5) * 20),
        motorPwm + Math.round((Math.random() - 0.5) * 20),
        0, 0, 0, 0,
      ],
    });
    ctx.protocol.emitServoOutput({
      timestamp: now, port: 1,
      servos: [0, 0, 0, 0, 0, 0, 0, 0],
    });
  }

  // Heartbeat at 1Hz
  if (ctx.tickCount % 5 === 0) {
    ctx.protocol.emitHeartbeat(
      ctx.status === "in_mission",
      ctx.flightMode as UnifiedFlightMode,
    );
  }

  // Wind at 1Hz
  if (ctx.tickCount % 5 === 0) {
    const windDir = 180 + Math.sin(ctx.tickCount * 0.01) * 45;
    ctx.protocol.emitWind({
      timestamp: now, direction: windDir,
      speed: 3 + Math.random() * 2, speedZ: -0.2 + Math.random() * 0.4,
    });
  }

  // Terrain at 1Hz
  if (ctx.tickCount % 5 === 0) {
    ctx.protocol.emitTerrain({
      timestamp: now, lat: ctx.pos.lat, lon: ctx.pos.lon,
      terrainHeight: 0, currentHeight: ctx.pos.alt,
      spacing: 30, pending: 0, loaded: 4,
    });
  }

  // ScaledIMU at ~2Hz
  if (ctx.tickCount % 3 === 0) {
    ctx.protocol.emitScaledImu({
      timestamp: now,
      imu: 0,
      xacc: Math.round((ctx.roll * 0.1 + (Math.random() - 0.5) * 2) * 100),
      yacc: Math.round((ctx.pitch * 0.1 + (Math.random() - 0.5) * 2) * 100),
      zacc: Math.round((-980 + (Math.random() - 0.5) * 5) * 1),
      xgyro: Math.round(ctx.roll * 10 + (Math.random() - 0.5) * 50),
      ygyro: Math.round(ctx.pitch * 5 + (Math.random() - 0.5) * 50),
      zgyro: Math.round(ctx.headingDelta * 2 + (Math.random() - 0.5) * 30),
      xmag: Math.round(200 + Math.sin(ctx.pos.heading * Math.PI / 180) * 150),
      ymag: Math.round(50 + Math.cos(ctx.pos.heading * Math.PI / 180) * 150),
      zmag: Math.round(400 + (Math.random() - 0.5) * 20),
    });
  }

  // HomePosition at 0.2Hz
  if (ctx.tickCount % 25 === 0) {
    const homePath = FLIGHT_PATHS[ctx.pathIndex];
    const homeWp = homePath?.[0];
    if (homeWp) {
      ctx.protocol.emitHomePosition({ timestamp: now, lat: homeWp.lat, lon: homeWp.lon, alt: 0 });
    }
  }

  // PowerStatus at 1Hz
  if (ctx.tickCount % 5 === 0) {
    ctx.protocol.emitPowerStatus({
      timestamp: now, vcc: 5000 + Math.floor(Math.random() * 100), vservo: 0, flags: 0,
    });
  }

  // DistanceSensor at ~2Hz
  if (ctx.tickCount % 3 === 0) {
    ctx.protocol.emitDistanceSensor({
      timestamp: now,
      currentDistance: Math.round(ctx.pos.alt * 100 + (Math.random() - 0.5) * 20),
      minDistance: 2, maxDistance: 12000, orientation: 25, id: 0, covariance: 5,
    });
  }

  // FenceStatus at 1Hz
  if (ctx.tickCount % 5 === 0) {
    ctx.protocol.emitFenceStatus({ timestamp: now, breachStatus: 0, breachCount: 0, breachType: 0 });
  }

  // NavController at ~2Hz
  if (ctx.tickCount % 3 === 0) {
    const targetWpIdx = (ctx.currentWaypointIdx + 1) % path.length;
    const targetWp = path[targetWpIdx];
    const bearing = Math.atan2(targetWp.lon - ctx.pos.lon, targetWp.lat - ctx.pos.lat) * (180 / Math.PI);
    const remainingDist = ctx.segmentDistances[ctx.currentWaypointIdx] ?? 0;
    ctx.protocol.emitNavController({
      timestamp: now,
      navBearing: ((bearing % 360) + 360) % 360,
      targetBearing: ((bearing % 360) + 360) % 360,
      wpDist: Math.round(remainingDist * (1 - ctx.pathProgress)),
      altError: (nextWp.alt - ctx.pos.alt) * (1 - ctx.pathProgress),
      xtrackError: (Math.random() - 0.5) * 2,
    });
  }

  // StatusText
  let newStatusMessageTick = ctx.statusMessageTick + 1;
  const msg = generateStatusMessage({
    waypointIndex: ctx.currentWaypointIdx,
    battery: ctx.battery,
    tickCount: newStatusMessageTick,
  });
  if (msg) {
    ctx.protocol.emitStatusText(msg.severity, msg.text);
  }

  return newStatusMessageTick;
}
