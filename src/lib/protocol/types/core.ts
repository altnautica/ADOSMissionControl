/**
 * Core data types for the protocol abstraction layer.
 *
 * @module protocol/types/core
 */

import type { FirmwareType, VehicleClass } from './enums';

/** Identity snapshot extracted from the first HEARTBEAT. */
export interface VehicleInfo {
  firmwareType: FirmwareType;
  vehicleClass: VehicleClass;
  firmwareVersionString: string;
  systemId: number;
  componentId: number;
  /** Raw MAV_AUTOPILOT enum value. */
  autopilotType: number;
  /** Raw MAV_TYPE enum value. */
  vehicleType: number;
  /** AP_FW_BOARD_ID from AUTOPILOT_VERSION (msg 148). Populated after first AUTOPILOT_VERSION received. */
  boardId?: number;
}

/** Result of a command acknowledged by the flight controller. */
export interface CommandResult {
  success: boolean;
  /** Raw MAV_RESULT enum value. */
  resultCode: number;
  message: string;
}

/** A single on-board parameter value. */
export interface ParameterValue {
  name: string;
  value: number;
  /** MAV_PARAM_TYPE enum. */
  type: number;
  index: number;
  count: number;
}

/** Feature gates — what the connected firmware actually supports. */
export interface ProtocolCapabilities {
  supportsArming: boolean;
  supportsFlightModes: boolean;
  supportsMissionUpload: boolean;
  supportsMissionDownload: boolean;
  supportsManualControl: boolean;
  supportsParameters: boolean;
  supportsCalibration: boolean;
  supportsSerialPassthrough: boolean;
  supportsMotorTest: boolean;
  supportsGeoFence: boolean;
  supportsRally: boolean;
  supportsLogDownload: boolean;
  // Panel-specific capabilities
  supportsOsd: boolean;
  supportsPidTuning: boolean;
  supportsPorts: boolean;
  supportsFailsafe: boolean;
  supportsPowerConfig: boolean;
  supportsReceiver: boolean;
  supportsFirmwareFlash: boolean;
  supportsCliShell: boolean;
  supportsMavlinkInspector: boolean;
  // Peripheral capabilities
  supportsGimbal: boolean;
  supportsCamera: boolean;
  supportsLed: boolean;
  supportsBattery2: boolean;
  supportsRangefinder: boolean;
  supportsOpticalFlow: boolean;
  supportsObstacleAvoidance: boolean;
  supportsDebugValues: boolean;
  /** CAN bus passthrough — receives MAVLink CAN_FRAME (msg 386) for DroneCAN/UAVCAN traffic monitoring */
  supportsCanFrame: boolean;
  // MSP / Betaflight / iNav capabilities
  /** Betaflight aux mode configuration */
  supportsAuxModes: boolean;
  /** VTX configuration (SmartAudio/Tramp) */
  supportsVtx: boolean;
  /** Blackbox logging configuration */
  supportsBlackbox: boolean;
  /** Betaflight-specific configuration panel (features, beeper, arming) */
  supportsBetaflightConfig: boolean;
  /** GPS configuration (provider, SBAS, rescue) */
  supportsGpsConfig: boolean;
  /** Rate profile switching */
  supportsRateProfiles: boolean;
  /** Adjustment ranges (mid-flight param tweaking) */
  supportsAdjustments: boolean;
  // Metadata
  manualControlHz: number;
  parameterCount: number;
}

/** Single-axis PID gains. */
export interface PidValues {
  p: number;
  i: number;
  d: number;
  f?: number;
}

/** PID profile for the three principal axes. */
export interface PidProfile {
  roll: PidValues;
  pitch: PidValues;
  yaw: PidValues;
}
