/**
 * Mock serial passthrough responses and telemetry tick for MockProtocol.
 *
 * Extracted to keep mock-protocol.ts under 300 lines.
 *
 * @license GPL-3.0-only
 */

import type { SerialDataCallback } from "@/lib/protocol/types";

// ── Serial Passthrough ──────────────────────────────────────

export interface SerialContext {
  serialDataCbs: SerialDataCallback[];
}

export function handleSerialCommand(ctx: SerialContext, cmd: string): void {
  if (!cmd) return;

  const respond = (output: string) => {
    setTimeout(() => {
      const encoded = new TextEncoder().encode(output + '\n');
      for (const cb of ctx.serialDataCbs) cb({ device: 10, data: encoded });
    }, 100);
  };

  if (cmd === 'top') {
    respond(
      'Processes: 42 total, 1 running, 41 sleeping\n' +
      '  PID COMMAND          CPU(%)  USED/STACK\n' +
      '    1 init              0.0   1024/ 2048\n' +
      '    2 wq:hp_default     1.2    832/ 1536\n' +
      '    3 wq:lp_default     0.3    640/ 1280\n' +
      '   42 mavlink_main      2.1   1280/ 2560\n' +
      '   51 commander         1.5   1536/ 3072\n' +
      '   67 mc_att_control    4.2   1024/ 2048\n' +
      '   78 ekf2              8.3   2048/ 4096\n' +
      '  CPU usage: 18.6%   Idling: 81.4%'
    );
  } else if (cmd.startsWith('listener')) {
    respond(
      'TOPIC: sensor_combined\n' +
      '  timestamp: 285043215\n' +
      '  gyro_rad[3]: [0.0012, -0.0008, 0.0003]\n' +
      '  accelerometer_m_s2[3]: [0.12, -0.08, -9.78]'
    );
  } else if (cmd === 'dmesg') {
    respond(
      'HW arch: PX4_FMU_V5\n' +
      'HW type: V500\n' +
      'FW git-hash: a1b2c3d4\n' +
      'NuttX: Release 11.0.0\n' +
      'Boot complete'
    );
  } else if (cmd === 'param show') {
    respond(
      'Symbols: x = used, + = changed, * = unsaved\n' +
      'x   SYS_AUTOSTART [4001] : 4001\n' +
      'x   SYS_AUTOCONFIG [0] : 0\n' +
      'x   COM_RC_LOSS_T [0.5] : 0.500000\n' +
      'x   BAT1_SOURCE [0] : 0\n' +
      ' 1467 parameters total, 892 used.'
    );
  } else if (cmd.startsWith('param show ')) {
    const paramName = cmd.slice(11).trim();
    respond(`x   ${paramName} [0] : 0`);
  } else if (cmd === 'mavlink status') {
    respond(
      'instance #0:\n' +
      '  GCS heartbeat: 1245 us ago\n' +
      '  mavlink chan: #0\n' +
      '  type: GENERIC LINK\n' +
      '  tx: 24.3 kB/s  rx: 1.2 kB/s\n' +
      '  rate mult: 1.000'
    );
  } else if (cmd === 'uorb top') {
    respond(
      'update: 1s, num topics: 186\n' +
      'TOPIC NAME                INST #SUB #MSG #LOST #Q\n' +
      'sensor_combined              0    6  250     0  4\n' +
      'vehicle_attitude             0    4  250     0  4\n' +
      'vehicle_local_position       0    5   50     0  4\n' +
      'battery_status               0    3   10     0  4'
    );
  } else if (cmd === 'perf') {
    respond(
      'PERF: EKF       60 events, 16666us avg, min 15800us max 18200us 0.12ms rms\n' +
      'PERF: ATTITUDE  250 events, 4000us avg, min 3800us max 4500us 0.08ms rms\n' +
      'PERF: COMMANDER 50 events, 20000us avg, min 19000us max 22000us 0.15ms rms'
    );
  } else {
    respond(`nsh: ${cmd}: command not found`);
  }
}

// ── Mock Telemetry Tick ─────────────────────────────────────

export interface TelemetryTickContext {
  emitDebug(data: { timestamp: number; name: string; value: number; type: "float" | "int" | "debug" }): void;
  emitGimbalAttitude(data: { timestamp: number; pitch: number; roll: number; yaw: number; angularVelocityX: number; angularVelocityY: number; angularVelocityZ: number }): void;
  emitObstacleDistance(data: { timestamp: number; distances: number[]; minDistance: number; maxDistance: number; increment: number; incrementF: number; angleOffset: number; frame: number }): void;
  emitLocalPosition(data: { timestamp: number; x: number; y: number; z: number; vx: number; vy: number; vz: number }): void;
  emitCameraImageCaptured(data: { timestamp: number; lat: number; lon: number; alt: number; imageIndex: number; cameraId: number; captureResult: number; fileUrl: string }): void;
}

const MOCK_HOME_LAT = 0.0;
const MOCK_HOME_LON = 0.0;

export function startTelemetryTick(
  ctx: TelemetryTickContext,
  timers: ReturnType<typeof setInterval>[],
  imageCounter: { value: number },
): void {
  // Debug values: 3 named floats every 2 seconds
  timers.push(
    setInterval(() => {
      const now = Date.now();
      ctx.emitDebug({ timestamp: now, name: "BaroAlt", value: 10 + Math.random() * 2, type: "float" });
      ctx.emitDebug({ timestamp: now, name: "RangefinderDist", value: 8 + Math.random() * 4, type: "float" });
      ctx.emitDebug({ timestamp: now, name: "OptFlowQual", value: 180 + Math.random() * 75, type: "float" });
    }, 2000),
  );

  // Gimbal attitude: oscillating pitch/roll, yaw follows heading, every 500ms
  let gimbalTick = 0;
  timers.push(
    setInterval(() => {
      gimbalTick++;
      const t = gimbalTick * 0.05;
      ctx.emitGimbalAttitude({
        timestamp: Date.now(),
        pitch: -15 + -15 * Math.sin(t),
        roll: 5 * Math.sin(t * 1.3),
        yaw: (gimbalTick * 2) % 360,
        angularVelocityX: 0,
        angularVelocityY: 0,
        angularVelocityZ: 0,
      });
    }, 500),
  );

  // Obstacle distances: 12 sectors, mostly far, 2 closer, every 1 second
  timers.push(
    setInterval(() => {
      const distances = new Array(12).fill(1000);
      distances[3] = 200 + Math.random() * 600;
      distances[9] = 200 + Math.random() * 600;
      ctx.emitObstacleDistance({
        timestamp: Date.now(),
        distances,
        minDistance: 20,
        maxDistance: 1200,
        increment: 30,
        incrementF: 30,
        angleOffset: 0,
        frame: 12,
      });
    }, 1000),
  );

  // Local position NED: derived from mock home, every 200ms
  let localTick = 0;
  timers.push(
    setInterval(() => {
      localTick++;
      const t = localTick * 0.1;
      ctx.emitLocalPosition({
        timestamp: Date.now(),
        x: 10 * Math.sin(t * 0.3),
        y: 10 * Math.cos(t * 0.2),
        z: -(10 + Math.sin(t * 0.15)),
        vx: 0.3 * Math.cos(t * 0.3),
        vy: -0.2 * Math.sin(t * 0.2),
        vz: -0.1 * Math.cos(t * 0.15),
      });
    }, 200),
  );

  // Camera image captured: every 10 seconds
  timers.push(
    setInterval(() => {
      imageCounter.value++;
      ctx.emitCameraImageCaptured({
        timestamp: Date.now(),
        lat: MOCK_HOME_LAT + (Math.random() - 0.5) * 0.001,
        lon: MOCK_HOME_LON + (Math.random() - 0.5) * 0.001,
        alt: 50 + Math.random() * 10,
        imageIndex: imageCounter.value,
        cameraId: 0,
        captureResult: 1,
        fileUrl: `IMG_${String(imageCounter.value).padStart(4, "0")}.jpg`,
      });
    }, 10000),
  );
}
