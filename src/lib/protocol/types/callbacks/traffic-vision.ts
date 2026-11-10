/**
 * Traffic, gimbal, CAN, flow and vision telemetry callbacks.
 *
 * Shapes reuse the store telemetry interfaces where they match, so
 * protocol → store bridging is a plain assignment.
 *
 * @module protocol/types/callbacks/traffic-vision
 */

import type { RcData, ScaledImuData } from '../../../types/telemetry';

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

/**
 * A camera's advertisement (MAVLink CAMERA_INFORMATION), one call per
 * message. `capture` and `zoom` are its CAMERA_CAP_FLAGS for still capture
 * and basic zoom.
 */
export type CameraInformationCallback = (data: {
  timestamp: number;
  /** The MAVLink component that sent it; commands for this camera go there. */
  compId: number;
  flags: number;
  cameraDeviceId: number;
  capture: boolean;
  zoom: boolean;
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

export type RawImuCallback = (data: ScaledImuData) => void;

export type RcChannelsRawCallback = (data: RcData & {
  port: number;
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
