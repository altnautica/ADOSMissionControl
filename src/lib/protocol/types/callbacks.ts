/**
 * Telemetry callback type aliases for the protocol abstraction layer.
 *
 * Shapes are kept compatible with the store types (AttitudeData, etc.)
 * so protocol → store bridging is a plain assignment.
 *
 * @module protocol/types/callbacks
 */

import type { UnifiedFlightMode, AccelCalPosition } from './enums';
import type { VehicleInfo, ParameterValue } from './core';

export type AttitudeCallback = (data: {
  timestamp: number;
  roll: number;
  pitch: number;
  yaw: number;
  /** rad/s; absent when the link does not report body rates (MSP). */
  rollSpeed?: number;
  pitchSpeed?: number;
  yawSpeed?: number;
}) => void;

export type PositionCallback = (data: {
  timestamp: number;
  lat: number;
  lon: number;
  alt: number;
  /** Metres above home; absent when the link has no height-above-home estimate. */
  relativeAlt?: number;
  /** Degrees; absent when the source reports no heading (GLOBAL_POSITION_INT hdg UINT16_MAX). */
  heading?: number;
  groundSpeed: number;
  /** m/s; omitted when the message carries no airspeed (on MAVLink, VFR_HUD owns it). */
  airSpeed?: number;
  /** m/s; absent when the source message carries no vertical speed (MSP GPS). */
  climbRate?: number;
}) => void;

export type BatteryCallback = (data: {
  timestamp: number;
  /**
   * Battery instance (BATTERY_STATUS.id). 0 is the primary pack; further
   * monitors (a second pack, an avionics rail) report their own ids.
   */
  id: number;
  voltage: number;
  /** Amps; absent when the monitor does not measure current. */
  current?: number;
  remaining: number;
  /** mAh; absent when the monitor does not count consumption. */
  consumed?: number;
  temperature?: number;
  cellVoltages?: number[];
  /** Series cell count the FC reports for the pack; absent when unknown. */
  cellCount?: number;
}) => void;

export type GpsCallback = (data: {
  timestamp: number;
  fixType: number;
  /** Absent when the receiver reports the count as unknown (255). */
  satellites?: number;
  /** Absent when the receiver reports no HDOP (eph UINT16_MAX) or omits it. */
  hdop?: number;
  lat: number;
  lon: number;
  alt: number;
}) => void;

export type VfrCallback = (data: {
  timestamp: number;
  /** Absent when the source message does not carry it (MSP altitude samples). */
  airspeed?: number;
  groundspeed?: number;
  heading?: number;
  throttle?: number;
  alt: number;
  climb: number;
}) => void;

export type RcCallback = (data: {
  timestamp: number;
  channels: number[];
  rssi: number;
}) => void;

export type StatusTextCallback = (data: {
  severity: number;
  text: string;
}) => void;

/** MAVLink EVENT (msg 410) — the PX4 structured-events successor to STATUSTEXT.
 * `id` = (componentId << 24) | subId, keying the events metadata; `logLevels`
 * is a 4-bit MSB internal + 4-bit LSB external level; `arguments` are packed
 * bytes decoded per the event's metadata argument types. */
export type EventCallback = (data: {
  id: number;
  eventTimeBootMs: number;
  sequence: number;
  destinationComponent: number;
  destinationSystem: number;
  logLevels: number;
  arguments: Uint8Array;
}) => void;

export type HeartbeatCallback = (data: {
  armed: boolean;
  mode: UnifiedFlightMode;
  systemStatus: number;
  vehicleInfo: VehicleInfo;
}) => void;

export type ParameterCallback = (data: ParameterValue) => void;

export type SerialDataCallback = (data: { device: number; data: Uint8Array }) => void;

export type SysStatusCallback = (data: {
  timestamp: number;
  cpuLoad: number;
  sensorsPresent: number;
  sensorsEnabled: number;
  sensorsHealthy: number;
  /** Absent when the source does not measure it. */
  voltageMv?: number;
  currentCa?: number;
  batteryRemaining: number;
  dropRateComm: number;
  errorsComm: number;
}) => void;

export type RadioCallback = (data: {
  timestamp: number;
  rssi: number;
  remrssi: number;
  txbuf: number;
  noise: number;
  remnoise: number;
  rxerrors: number;
  fixed: number;
  /** MAVLink system id of the radio that sent the report; decides the rssi scale. */
  sourceSystemId: number;
}) => void;

export type MissionProgressCallback = (data: {
  currentSeq: number;
  reachedSeq?: number;
}) => void;

export type EkfCallback = (data: {
  timestamp: number;
  velocityVariance: number;
  posHorizVariance: number;
  posVertVariance: number;
  compassVariance: number;
  terrainAltVariance: number;
  flags: number;
}) => void;

export type VibrationCallback = (data: {
  timestamp: number;
  vibrationX: number;
  vibrationY: number;
  vibrationZ: number;
  clipping0: number;
  clipping1: number;
  clipping2: number;
}) => void;

export type ServoOutputCallback = (data: {
  timestamp: number;
  port: number;
  servos: number[];
}) => void;

export type WindCallback = (data: {
  timestamp: number;
  direction: number;
  speed: number;
  speedZ: number;
}) => void;

export type TerrainCallback = (data: {
  timestamp: number;
  lat: number;
  lon: number;
  terrainHeight: number;
  currentHeight: number;
  spacing: number;
  pending: number;
  loaded: number;
}) => void;

export type MagCalProgressCallback = (data: {
  compassId: number;
  completionPct: number;
  calStatus: number;
  completionMask: number[];
  directionX: number;
  directionY: number;
  directionZ: number;
}) => void;

export type MagCalReportCallback = (data: {
  compassId: number;
  calStatus: number;
  autosaved: number;
  ofsX: number;
  ofsY: number;
  ofsZ: number;
  fitness: number;
  diagX: number;
  diagY: number;
  diagZ: number;
  offdiagX: number;
  offdiagY: number;
  offdiagZ: number;
  orientationConfidence: number;
  oldOrientation: number;
  newOrientation: number;
  scaleFactor: number;
}) => void;

export type AccelCalPosCallback = (data: { position: AccelCalPosition }) => void;

export type HomePositionCallback = (data: {
  timestamp: number;
  lat: number;
  lon: number;
  alt: number;
}) => void;

/** AUTOPILOT_VERSION (msg 148) as delivered to subscribers. */
export interface AutopilotVersionData {
  capabilities: number;
  flightSwVersion: number;
  middlewareSwVersion: number;
  osSwVersion: number;
  /** Raw AUTOPILOT_VERSION.board_version as sent on the wire. */
  boardVersion: number;
  /**
   * AP_FW_BOARD_ID decoded from board_version (ArduPilot sends it in the upper
   * 16 bits). Undefined when the firmware does not report a board id there.
   */
  boardId?: number;
  uid: number;
}

export type AutopilotVersionCallback = (data: AutopilotVersionData) => void;

export type PowerStatusCallback = (data: {
  timestamp: number;
  vcc: number;
  vservo: number;
  flags: number;
}) => void;

export type DistanceSensorCallback = (data: {
  timestamp: number;
  currentDistance: number;
  minDistance: number;
  maxDistance: number;
  orientation: number;
  id: number;
  covariance: number;
}) => void;

export type FenceStatusCallback = (data: {
  timestamp: number;
  breachStatus: number;
  breachCount: number;
  breachType: number;
}) => void;

export type NavControllerCallback = (data: {
  timestamp: number;
  navBearing: number;
  targetBearing: number;
  wpDist: number;
  altError: number;
  xtrackError: number;
}) => void;

/** SCALED_IMU/2/3: acceleration in mG, angular rate in mrad/s, field in mgauss. */
export type ScaledImuCallback = (data: {
  timestamp: number;
  /** IMU instance: 0 for SCALED_IMU, 1 for SCALED_IMU2, 2 for SCALED_IMU3. */
  imu: number;
  xacc: number;
  yacc: number;
  zacc: number;
  xgyro: number;
  ygyro: number;
  zgyro: number;
  xmag: number;
  ymag: number;
  zmag: number;
}) => void;

export type ScaledPressureCallback = (data: {
  timestamp: number;
  pressAbs: number;
  pressDiff: number;
  temperature: number;
}) => void;

export type EstimatorStatusCallback = (data: {
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
}) => void;

/** CAMERA_TRIGGER carries only a shutter timestamp and sequence number — the
 *  message has no position field. */
export type CameraTriggerCallback = (data: {
  timestamp: number;
  seq: number;
}) => void;

export type LinkStateCallback = () => void;

export type LocalPositionCallback = (data: {
  timestamp: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}) => void;

export type DebugCallback = (data: {
  timestamp: number;
  name: string;
  value: number;
  type: "float" | "int" | "debug";
}) => void;

export type GimbalAttitudeCallback = (data: {
  timestamp: number;
  roll: number;
  pitch: number;
  yaw: number;
  angularVelocityX: number;
  angularVelocityY: number;
  angularVelocityZ: number;
}) => void;

export type ObstacleDistanceCallback = (data: {
  timestamp: number;
  distances: number[];
  minDistance: number;
  maxDistance: number;
  increment: number;
  incrementF: number;
  angleOffset: number;
  frame: number;
}) => void;

/**
 * One ADS-B contact (MAVLink ADSB_VEHICLE). Only contacts whose position the
 * receiver marks valid are delivered; every other field is `undefined` when its
 * ADSB_FLAGS bit says it is not valid.
 */
export interface AdsbContact {
  timestamp: number;
  icao: number;
  lat: number;
  lon: number;
  /** Metres; datum per `altitudeGeometric` (true = GNSS, false = pressure QNH). */
  altitudeM?: number;
  altitudeGeometric: boolean;
  headingDeg?: number;
  groundSpeedMs?: number;
  callsign?: string;
  squawk?: number;
  emitterType: number;
  /** Seconds since the receiver last heard this aircraft. */
  tslc: number;
}

export type AdsbVehicleCallback = (data: AdsbContact) => void;

export type CameraImageCapturedCallback = (data: {
  timestamp: number;
  lat: number;
  lon: number;
  alt: number;
  imageIndex: number;
  cameraId: number;
  captureResult: number;
  fileUrl: string;
}) => void;

export type ExtendedSysStateCallback = (data: {
  timestamp: number;
  vtolState: number;
  landedState: number;
}) => void;

export type FencePointCallback = (data: {
  timestamp: number;
  idx: number;
  count: number;
  lat: number;
  lon: number;
}) => void;

export type SystemTimeCallback = (data: {
  timestamp: number;
  timeUnixUsec: number;
  timeBootMs: number;
}) => void;

export type RawImuCallback = (data: {
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
}) => void;

export type RcChannelsRawCallback = (data: {
  timestamp: number;
  channels: number[];
  port: number;
  rssi: number;
}) => void;

export type RcChannelsOverrideCallback = (data: {
  timestamp: number;
  channels: number[];
  targetSystem: number;
  targetComponent: number;
}) => void;

export type MissionItemCallback = (data: {
  seq: number;
  frame: number;
  command: number;
  current: number;
  autocontinue: number;
  param1: number;
  param2: number;
  param3: number;
  param4: number;
  x: number;
  y: number;
  z: number;
}) => void;

export type AltitudeCallback = (data: {
  timestamp: number;
  altitudeMonotonic: number;
  /** Absent when the link does not report the quantity (MSP carries only the baro estimate). */
  altitudeAmsl?: number;
  altitudeLocal: number;
  altitudeRelative: number;
  altitudeTerrain?: number;
  bottomClearance?: number;
}) => void;

export type WindCovCallback = (data: {
  timestamp: number;
  windX: number;
  windY: number;
  windZ: number;
  varHoriz: number;
  varVert: number;
  windAlt: number;
  horizAccuracy: number;
  vertAccuracy: number;
}) => void;

export type AisVesselCallback = (data: {
  timestamp: number;
  MMSI: number;
  lat: number;
  lon: number;
  COG: number;
  heading: number;
  velocity: number;
  turnRate: number;
  navigationalStatus: number;
  type: number;
  callsign: string;
  name: string;
  flags: number;
}) => void;

export type GimbalManagerInfoCallback = (data: {
  timestamp: number;
  capFlags: number;
  gimbalDeviceId: number;
  rollMin: number;
  rollMax: number;
  pitchMin: number;
  pitchMax: number;
  yawMin: number;
  yawMax: number;
}) => void;

export type GimbalManagerStatusCallback = (data: {
  timestamp: number;
  flags: number;
  gimbalDeviceId: number;
  primaryControlSysid: number;
  primaryControlCompid: number;
  secondaryControlSysid: number;
  secondaryControlCompid: number;
}) => void;

/** CAN_FRAME (msg 386) — raw CAN frame from a flight controller's CAN bus. */
export type CanFrameCallback = (data: {
  timestamp: number;
  bus: number;
  len: number;
  targetSystem: number;
  targetComponent: number;
  /** 11-bit (standard) or 29-bit (extended) CAN identifier */
  id: number;
  /** Up to 8 data bytes */
  data: Uint8Array;
}) => void;

/** CANFD_FRAME (msg 387) — raw CAN FD frame (up to 64 data bytes). */
export type CanFdFrameCallback = (data: {
  timestamp: number;
  bus: number;
  len: number;
  targetSystem: number;
  targetComponent: number;
  /** 11-bit (standard) or 29-bit (extended) CAN identifier */
  id: number;
  /** Up to 64 data bytes */
  data: Uint8Array;
}) => void;

/** OPTICAL_FLOW (msg 100) — scalar optical-flow sensor output. */
export type OpticalFlowCallback = (data: {
  timestamp: number;
  timeUsec: bigint;
  sensorId: number;
  flowX: number;
  flowY: number;
  flowCompMX: number;
  flowCompMY: number;
  quality: number;
  groundDistance: number;
  flowRateX?: number;
  flowRateY?: number;
}) => void;

/** OPTICAL_FLOW_RAD (msg 106) — angular-rate optical-flow sensor output. */
export type OpticalFlowRadCallback = (data: {
  timestamp: number;
  timeUsec: bigint;
  sensorId: number;
  integrationTimeUs: number;
  integratedX: number;
  integratedY: number;
  integratedXgyro: number;
  integratedYgyro: number;
  integratedZgyro: number;
  /** Temperature in degC (converted from centi-degC on the wire). */
  temperature: number;
  quality: number;
  timeDeltaDistanceUs: number;
  distance: number;
}) => void;

/** ODOMETRY (msg 331) — full 6DoF odometry from a vision / VIO pipeline. */
export type OdometryCallback = (data: {
  timestamp: number;
  timeUsec: bigint;
  frameId: number;
  childFrameId: number;
  x: number;
  y: number;
  z: number;
  q: [number, number, number, number];
  vx: number;
  vy: number;
  vz: number;
  rollspeed: number;
  pitchspeed: number;
  yawspeed: number;
  poseCovariance: number[];
  velocityCovariance: number[];
  resetCounter: number;
  estimatorType: number;
  quality?: number;
}) => void;

/** VISION_POSITION_ESTIMATE (msg 102) — pre-fused local-frame vision pose. */
export type VisionPositionEstimateCallback = (data: {
  timestamp: number;
  usec: bigint;
  x: number;
  y: number;
  z: number;
  roll: number;
  pitch: number;
  yaw: number;
  covariance: number[];
  resetCounter: number;
}) => void;

/** VISION_POSITION_DELTA (msg 11011) — body-frame pose delta over a window. */
export type VisionPositionDeltaCallback = (data: {
  timestamp: number;
  timeUsec: bigint;
  timeDeltaUsec: bigint;
  angleDelta: [number, number, number];
  positionDelta: [number, number, number];
  confidence: number;
}) => void;
