/**
 * Estimator, sensor and calibration telemetry callbacks.
 *
 * Shapes reuse the store telemetry interfaces where they match, so
 * protocol → store bridging is a plain assignment.
 *
 * @module protocol/types/callbacks/sensors
 */

import type { AccelCalPosition } from '../enums';
import type { CameraTriggerData, DebugData, DistanceSensorData, EkfData, EstimatorStatusData, FenceStatusData, GimbalData, GpsOriginData, HomePositionData, LocalPositionData, NavControllerData, ObstacleData, PowerStatusData, ScaledImuData, ServoOutputData, TerrainData, VibrationData, WindData } from '../../../types/telemetry';

export type EkfCallback = (data: EkfData) => void;

export type VibrationCallback = (data: VibrationData) => void;

export type ServoOutputCallback = (data: ServoOutputData) => void;

export type WindCallback = (data: WindData) => void;

export type TerrainCallback = (data: TerrainData) => void;

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

export type HomePositionCallback = (data: HomePositionData) => void;

/** GPS_GLOBAL_ORIGIN (msg 49): the EKF origin. */
export type GpsOriginCallback = (data: GpsOriginData) => void;

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

export type PowerStatusCallback = (data: PowerStatusData) => void;

export type DistanceSensorCallback = (data: DistanceSensorData) => void;

export type FenceStatusCallback = (data: FenceStatusData) => void;

export type NavControllerCallback = (data: NavControllerData) => void;

/** SCALED_IMU/2/3: acceleration in mG, angular rate in mrad/s, field in mgauss. */
export type ScaledImuCallback = (data: ScaledImuData & {
  /** IMU instance: 0 for SCALED_IMU, 1 for SCALED_IMU2, 2 for SCALED_IMU3. */
  imu: number;
}) => void;

export type ScaledPressureCallback = (data: {
  timestamp: number;
  pressAbs: number;
  pressDiff: number;
  temperature: number;
}) => void;

export type EstimatorStatusCallback = (data: EstimatorStatusData) => void;

/** CAMERA_TRIGGER carries only a shutter timestamp and sequence number — the
 *  message has no position field. */
export type CameraTriggerCallback = (data: CameraTriggerData) => void;

export type LinkStateCallback = () => void;

export type LocalPositionCallback = (data: LocalPositionData) => void;

export type DebugCallback = (data: DebugData) => void;

export type GimbalAttitudeCallback = (data: GimbalData) => void;

export type ObstacleDistanceCallback = (data: ObstacleData) => void;
