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
  /**
   * The vehicle can be commanded to navigate on its own: return to home, take
   * off, hold, resume a mission. Whether a particular aircraft has the switch
   * or the mission for it is answered by the command itself; this says only
   * that the firmware has the capability at all.
   */
  supportsAutonomousNav: boolean;
  supportsGeoFence: boolean;
  supportsRally: boolean;
  supportsLogDownload: boolean;
  // Panel-specific capabilities
  supportsOsd: boolean;
  supportsDisplayPort: boolean;
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
  /** Betaflight-specific configuration panel (features, beeper, arming).
   * Betaflight only — iNav has its own configuration surfaces. */
  supportsBetaflightConfig: boolean;
  /** Shared MSP motors + ESC panel (MSP_MOTOR / MSP_SET_MOTOR). Both
   * Betaflight and iNav speak this, so it is gated separately from the
   * Betaflight-only configuration panel. */
  supportsMspMotors: boolean;
  /** GPS configuration (provider, SBAS, rescue) */
  supportsGpsConfig: boolean;
  /** EKF3 estimator config (source sets, noise, IMU mask) — ArduPilot */
  supportsEkfConfig: boolean;
  /** Per-port MAVLink telemetry stream rates (SRn_*) — ArduPilot */
  supportsStreamRates: boolean;
  /** QuadPlane/VTOL config (Q_* — tilt/tailsitter/transition) — ArduPlane */
  supportsVtolConfig: boolean;
  /** Fixed-wing TECS energy + L1 navigation tuning — ArduPlane */
  supportsTecsConfig: boolean;
  /** ArduSub depth-hold, joystick buttons, leak/pressure failsafe */
  supportsSubConfig: boolean;
  /** PX4 advanced tuning (MPC flight-behavior, FW TECS, autotune) */
  supportsPx4Tuning: boolean;
  /** Rate profile switching */
  supportsRateProfiles: boolean;
  /** Adjustment ranges (mid-flight param tweaking) */
  supportsAdjustments: boolean;
  /**
   * MAVLink v2 message signing (HMAC-SHA256 with 32-byte shared key).
   * True only when: firmware is ArduPilot, version >= 4.0, and at least
   * one SIGNING_* param is present on the FC. MSP firmwares always false.
   * PX4 false for now (no persistent on-board key store).
   */
  supportsMavlinkSigning: boolean;
  // iNav-specific capabilities
  /** Multi-mission storage and selection */
  supportsMultiMission: boolean;
  /** Safehome positions (fallback landing sites) */
  supportsSafehome: boolean;
  /** Geofence zones with polygon and circular shapes */
  supportsGeozone: boolean;
  /** Logic conditions (programmable IF/THEN rules) */
  supportsLogicConditions: boolean;
  /** Global variables (shared numeric state for logic conditions) */
  supportsGlobalVariables: boolean;
  /** Programming PIDs (programmable PID controllers) */
  supportsProgrammingPid: boolean;
  /** EzTune (simplified tuning interface) */
  supportsEzTune: boolean;
  /** Fixed-wing approach configuration per safehome */
  supportsFwApproach: boolean;
  /** Custom OSD elements (user-defined screen items) */
  supportsCustomOsd: boolean;
  /** Mixer profile switching */
  supportsMixerProfile: boolean;
  /** Battery profile switching */
  supportsBatteryProfile: boolean;
  /** Temperature sensor configuration and readings */
  supportsTempSensors: boolean;
  /** Servo mixer rule configuration */
  supportsServoMixer: boolean;
  /** Extended output mapping (timer/function labels) */
  supportsOutputMappingExt: boolean;
  /** Rate dynamics (input filter for rate control) */
  supportsRateDynamics: boolean;
  /** Multicopter braking configuration */
  supportsMcBraking: boolean;
  /** Name-based settings via MSP2_COMMON_SETTING */
  supportsSettings: boolean;
  /** Full settings reachable only over the text CLI (Betaflight `get`/`set`/`dump`) */
  supportsCliSettings: boolean;
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
