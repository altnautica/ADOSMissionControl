/**
 * Telemetry data interfaces for all sensor/state streams.
 * @module types/telemetry
 */

export interface AttitudeData {
  timestamp: number;
  roll: number;    // degrees
  pitch: number;   // degrees
  yaw: number;     // degrees (heading)
  rollSpeed: number;
  pitchSpeed: number;
  yawSpeed: number;
}

export interface PositionData {
  timestamp: number;
  lat: number;
  lon: number;
  alt: number;        // meters AGL
  relativeAlt: number;
  heading: number;    // degrees 0-360
  groundSpeed: number; // m/s
  airSpeed: number;    // m/s
  climbRate: number;   // m/s
}

export interface BatteryData {
  timestamp: number;
  voltage: number;     // volts
  current: number;     // amps
  remaining: number;   // percentage 0-100
  consumed: number;    // mAh
  temperature?: number; // celsius (from BATTERY_STATUS temperature field)
  cellVoltages?: number[]; // per-cell voltages in volts (from BATTERY_STATUS voltages[10])
}

export interface GpsData {
  timestamp: number;
  fixType: number;     // 0=none, 2=2D, 3=3D
  satellites: number;
  hdop: number;
  lat: number;
  lon: number;
  alt: number;         // meters MSL
}

export interface VfrData {
  timestamp: number;
  airspeed: number;    // m/s
  groundspeed: number; // m/s
  heading: number;     // degrees
  throttle: number;    // percentage 0-100
  alt: number;         // meters
  climb: number;       // m/s
}

export interface RcData {
  timestamp: number;
  channels: number[];  // RC channel values (typically 16 channels)
  rssi: number;        // signal strength 0-255
}

// ── SYS_STATUS ─────────────────────────────────────────────
export interface SysStatusData {
  timestamp: number;
  cpuLoad: number;            // 0-1000 (0.1% units)
  sensorsPresent: number;     // raw bitmask
  sensorsEnabled: number;
  sensorsHealthy: number;
  voltageMv: number;
  currentCa: number;
  batteryRemaining: number;
  dropRateComm: number;
  errorsComm: number;
}

// ── Radio Link ─────────────────────────────────────────────
export interface RadioData {
  timestamp: number;
  rssi: number;
  remrssi: number;
  txbuf: number;
  noise: number;
  remnoise: number;
  rxerrors: number;
  fixed: number;
}

// ── EKF Status ──────────────────────────────────────────────

export interface EkfData {
  timestamp: number;
  velocityVariance: number;
  posHorizVariance: number;
  posVertVariance: number;
  compassVariance: number;
  terrainAltVariance: number;
  flags: number;
}

// ── Vibration ───────────────────────────────────────────────

export interface VibrationData {
  timestamp: number;
  vibrationX: number;
  vibrationY: number;
  vibrationZ: number;
  clipping0: number;
  clipping1: number;
  clipping2: number;
}

// ── Servo Output ────────────────────────────────────────────

export interface ServoOutputData {
  timestamp: number;
  port: number;
  servos: number[];  // up to 8 PWM values
}

// ── Wind ────────────────────────────────────────────────────

export interface WindData {
  timestamp: number;
  direction: number;  // degrees
  speed: number;      // m/s
  speedZ: number;     // m/s
}

// ── Terrain ─────────────────────────────────────────────────

export interface TerrainData {
  timestamp: number;
  lat: number;
  lon: number;
  terrainHeight: number;  // m AMSL
  currentHeight: number;  // m above terrain
  spacing: number;
  pending: number;
  loaded: number;
}

// ── Local Position ─────────────────────────────────────────

export interface LocalPositionData {
  timestamp: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

// ── Debug Values ───────────────────────────────────────────

export interface DebugData {
  timestamp: number;
  name: string;
  value: number;
  type: "float" | "int" | "debug";
}

// ── Gimbal ─────────────────────────────────────────────────

export interface GimbalData {
  timestamp: number;
  roll: number;
  pitch: number;
  yaw: number;
  angularVelocityX: number;
  angularVelocityY: number;
  angularVelocityZ: number;
}

// ── Obstacle Distance ──────────────────────────────────────

export interface ObstacleData {
  timestamp: number;
  distances: number[];
  minDistance: number;
  maxDistance: number;
  increment: number;
  incrementF: number;
  angleOffset: number;
  frame: number;
}

// ── Scaled IMU ────────────────────────────────────────────

export interface ScaledImuData {
  timestamp: number;
  xacc: number;
  yacc: number;
  zacc: number;
  xgyro: number;
  ygyro: number;
  zgyro: number;
  xmag: number;
  ymag: number;
  zmag: number;
}

// ── Home Position ─────────────────────────────────────────

export interface HomePositionData {
  timestamp: number;
  lat: number;
  lon: number;
  alt: number;
}

// ── Power Status ──────────────────────────────────────────

export interface PowerStatusData {
  timestamp: number;
  vcc: number;
  vservo: number;
  flags: number;
}

// ── Distance Sensor ───────────────────────────────────────

export interface DistanceSensorData {
  timestamp: number;
  currentDistance: number;
  minDistance: number;
  maxDistance: number;
  orientation: number;
  id: number;
  covariance: number;
}

// ── Fence Status ──────────────────────────────────────────

export interface FenceStatusData {
  timestamp: number;
  breachStatus: number;
  breachCount: number;
  breachType: number;
}

// ── Estimator Status ─────────────────────────────────────

export interface EstimatorStatusData {
  timestamp: number;
  velRatio: number;
  posHorizRatio: number;
  posVertRatio: number;
  magRatio: number;
  haglRatio: number;
  tasRatio: number;
  posHorizAccuracy: number;
  posVertAccuracy: number;
  flags: number;
}

// ── Camera Trigger ───────────────────────────────────────

/**
 * A shutter event from MAVLink CAMERA_TRIGGER (112).
 *
 * The message carries a timestamp and a sequence number and nothing else. It
 * used to declare lat/lon/alt, which the decoder read from past the end of the
 * 12-byte payload and the handler recorded as 0°N 0°E in the flight record.
 */
export interface CameraTriggerData {
  timestamp: number;
  seq: number;
}

// ── Nav Controller ────────────────────────────────────────

export interface NavControllerData {
  timestamp: number;
  navBearing: number;
  targetBearing: number;
  wpDist: number;
  altError: number;
  xtrackError: number;
}
