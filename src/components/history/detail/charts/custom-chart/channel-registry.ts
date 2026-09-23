// Exempt from 300 LOC soft rule: registry of per-channel field
// extractors, splitting hurts readability and there's no clean cleavage.
/**
 * @module history/detail/charts/custom-chart/channel-registry
 * @description Per-channel field registry for the Custom Chart Builder.
 * Each entry declares the human label, the unit, and the extractor that
 * pulls the numeric value out of a recorded `TelemetryFrame.data` blob.
 * @license GPL-3.0-only
 */

import type { ChannelDef } from "./types";

const RAD_TO_DEG = 180 / Math.PI;

function num(v: unknown): number | undefined {
  return typeof v === "number" && isFinite(v) ? v : undefined;
}

/** Body rates are recorded in rad/s (ATTITUDE rollspeed etc. pass through). */
function rateDeg(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : n * RAD_TO_DEG;
}

function chanAt(v: unknown, idx: number): number | undefined {
  if (!Array.isArray(v)) return undefined;
  return num(v[idx]);
}

export const CHANNEL_REGISTRY: ChannelDef[] = [
  {
    channel: "position",
    label: "Position",
    fields: [
      { key: "relativeAlt", label: "Rel Alt", unit: "m", extract: (d) => num(d.relativeAlt) },
      { key: "alt", label: "Altitude MSL", unit: "m", extract: (d) => num(d.alt) },
      { key: "groundSpeed", label: "Ground Speed", unit: "m/s", extract: (d) => num(d.groundSpeed) },
      { key: "climbRate", label: "Climb Rate", unit: "m/s", extract: (d) => num(d.climbRate) },
      { key: "heading", label: "Heading", unit: "°", extract: (d) => num(d.heading) },
    ],
  },
  {
    channel: "globalPosition",
    label: "Global Position",
    fields: [
      { key: "relativeAlt", label: "Rel Alt", unit: "m", extract: (d) => num(d.relativeAlt) },
      { key: "alt", label: "Altitude MSL", unit: "m", extract: (d) => num(d.alt) },
      { key: "groundSpeed", label: "Ground Speed", unit: "m/s", extract: (d) => num(d.groundSpeed) },
      { key: "heading", label: "Heading", unit: "°", extract: (d) => num(d.heading) },
    ],
  },
  {
    channel: "attitude",
    label: "Attitude",
    fields: [
      // Recorded attitude angles are degrees (the AttitudeData contract).
      { key: "roll", label: "Roll", unit: "°", extract: (d) => num(d.roll) },
      { key: "pitch", label: "Pitch", unit: "°", extract: (d) => num(d.pitch) },
      { key: "yaw", label: "Yaw", unit: "°", extract: (d) => num(d.yaw) },
      { key: "rollSpeed", label: "Roll Rate", unit: "°/s", extract: (d) => rateDeg(d.rollSpeed) },
      { key: "pitchSpeed", label: "Pitch Rate", unit: "°/s", extract: (d) => rateDeg(d.pitchSpeed) },
      { key: "yawSpeed", label: "Yaw Rate", unit: "°/s", extract: (d) => rateDeg(d.yawSpeed) },
    ],
  },
  {
    channel: "battery",
    label: "Battery",
    fields: [
      { key: "voltage", label: "Voltage", unit: "V", extract: (d) => num(d.voltage) },
      { key: "current", label: "Current", unit: "A", extract: (d) => num(d.current) },
      { key: "remaining", label: "Remaining", unit: "%", extract: (d) => num(d.remaining) },
      { key: "consumed", label: "Consumed", unit: "mAh", extract: (d) => num(d.consumed) },
      { key: "temperature", label: "Temperature", unit: "°C", extract: (d) => num(d.temperature) },
    ],
  },
  {
    channel: "vfr",
    label: "VFR HUD",
    fields: [
      { key: "airspeed", label: "Airspeed", unit: "m/s", extract: (d) => num(d.airspeed) },
      { key: "groundspeed", label: "Ground Speed", unit: "m/s", extract: (d) => num(d.groundspeed) },
      { key: "throttle", label: "Throttle", unit: "%", extract: (d) => num(d.throttle) },
      { key: "alt", label: "Altitude", unit: "m", extract: (d) => num(d.alt) },
      { key: "climb", label: "Climb", unit: "m/s", extract: (d) => num(d.climb) },
    ],
  },
  {
    channel: "gps",
    label: "GPS",
    fields: [
      { key: "satellites", label: "Satellites", unit: "", extract: (d) => num(d.satellites) },
      { key: "hdop", label: "HDOP", unit: "", extract: (d) => num(d.hdop) },
      { key: "fixType", label: "Fix Type", unit: "", extract: (d) => num(d.fixType) },
    ],
  },
  {
    channel: "vibration",
    label: "Vibration",
    fields: [
      { key: "vibrationX", label: "Vib X", unit: "m/s²", extract: (d) => num(d.vibrationX) },
      { key: "vibrationY", label: "Vib Y", unit: "m/s²", extract: (d) => num(d.vibrationY) },
      { key: "vibrationZ", label: "Vib Z", unit: "m/s²", extract: (d) => num(d.vibrationZ) },
    ],
  },
  {
    channel: "rc",
    label: "RC Input",
    fields: [
      { key: "ch1", label: "CH1 (Roll)", unit: "µs", extract: (d) => chanAt(d.channels, 0) },
      { key: "ch2", label: "CH2 (Pitch)", unit: "µs", extract: (d) => chanAt(d.channels, 1) },
      { key: "ch3", label: "CH3 (Throttle)", unit: "µs", extract: (d) => chanAt(d.channels, 2) },
      { key: "ch4", label: "CH4 (Yaw)", unit: "µs", extract: (d) => chanAt(d.channels, 3) },
      { key: "ch5", label: "CH5", unit: "µs", extract: (d) => chanAt(d.channels, 4) },
      { key: "ch6", label: "CH6", unit: "µs", extract: (d) => chanAt(d.channels, 5) },
      { key: "ch7", label: "CH7", unit: "µs", extract: (d) => chanAt(d.channels, 6) },
      { key: "ch8", label: "CH8", unit: "µs", extract: (d) => chanAt(d.channels, 7) },
    ],
  },
  {
    channel: "servoOutput",
    label: "Servo Output",
    fields: [
      { key: "ch1", label: "Out 1", unit: "µs", extract: (d) => chanAt(d.channels, 0) },
      { key: "ch2", label: "Out 2", unit: "µs", extract: (d) => chanAt(d.channels, 1) },
      { key: "ch3", label: "Out 3", unit: "µs", extract: (d) => chanAt(d.channels, 2) },
      { key: "ch4", label: "Out 4", unit: "µs", extract: (d) => chanAt(d.channels, 3) },
      { key: "ch5", label: "Out 5", unit: "µs", extract: (d) => chanAt(d.channels, 4) },
      { key: "ch6", label: "Out 6", unit: "µs", extract: (d) => chanAt(d.channels, 5) },
      { key: "ch7", label: "Out 7", unit: "µs", extract: (d) => chanAt(d.channels, 6) },
      { key: "ch8", label: "Out 8", unit: "µs", extract: (d) => chanAt(d.channels, 7) },
    ],
  },
  {
    channel: "ekf",
    label: "EKF Status",
    fields: [
      { key: "velocityVariance", label: "Velocity Var", unit: "", extract: (d) => num(d.velocityVariance) },
      { key: "posHorizVariance", label: "Pos Horiz Var", unit: "", extract: (d) => num(d.posHorizVariance) },
      { key: "posVertVariance", label: "Pos Vert Var", unit: "", extract: (d) => num(d.posVertVariance) },
      { key: "compassVariance", label: "Compass Var", unit: "", extract: (d) => num(d.compassVariance) },
      { key: "terrainAltVariance", label: "Terrain Alt Var", unit: "", extract: (d) => num(d.terrainAltVariance) },
    ],
  },
  {
    channel: "wind",
    label: "Wind",
    fields: [
      { key: "direction", label: "Direction", unit: "°", extract: (d) => num(d.direction) },
      { key: "speed", label: "Speed", unit: "m/s", extract: (d) => num(d.speed) },
      { key: "speedZ", label: "Vertical Speed", unit: "m/s", extract: (d) => num(d.speedZ) },
    ],
  },
  {
    channel: "scaledImu",
    label: "Scaled IMU",
    fields: [
      { key: "xacc", label: "Accel X", unit: "mg", extract: (d) => num(d.xacc) },
      { key: "yacc", label: "Accel Y", unit: "mg", extract: (d) => num(d.yacc) },
      { key: "zacc", label: "Accel Z", unit: "mg", extract: (d) => num(d.zacc) },
      { key: "xgyro", label: "Gyro X", unit: "mrad/s", extract: (d) => num(d.xgyro) },
      { key: "ygyro", label: "Gyro Y", unit: "mrad/s", extract: (d) => num(d.ygyro) },
      { key: "zgyro", label: "Gyro Z", unit: "mrad/s", extract: (d) => num(d.zgyro) },
      { key: "xmag", label: "Mag X", unit: "mgauss", extract: (d) => num(d.xmag) },
      { key: "ymag", label: "Mag Y", unit: "mgauss", extract: (d) => num(d.ymag) },
      { key: "zmag", label: "Mag Z", unit: "mgauss", extract: (d) => num(d.zmag) },
    ],
  },
  {
    channel: "radio",
    label: "Radio Link",
    fields: [
      { key: "rssi", label: "RSSI", unit: "", extract: (d) => num(d.rssi) },
      { key: "remrssi", label: "Remote RSSI", unit: "", extract: (d) => num(d.remrssi) },
      { key: "noise", label: "Noise", unit: "", extract: (d) => num(d.noise) },
      { key: "remnoise", label: "Remote Noise", unit: "", extract: (d) => num(d.remnoise) },
    ],
  },
  {
    channel: "terrain",
    label: "Terrain",
    fields: [
      { key: "terrainHeight", label: "Terrain Height", unit: "m", extract: (d) => num(d.terrainHeight) },
      { key: "currentHeight", label: "Current AGL", unit: "m", extract: (d) => num(d.currentHeight) },
    ],
  },
];
