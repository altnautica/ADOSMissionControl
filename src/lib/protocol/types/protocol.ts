/**
 * Main DroneProtocol interface : the top-level API surface for the GCS.
 *
 * @module protocol/types/protocol
 */

import type { Transport } from './transport';
import type { UnifiedFlightMode } from './enums';
import type { VehicleInfo, CommandResult, ParameterValue, ProtocolCapabilities } from './core';
import type {
  AttitudeCallback, PositionCallback, BatteryCallback, GpsCallback,
  VfrCallback, RcCallback, StatusTextCallback, EventCallback, HeartbeatCallback,
  ParameterCallback, SerialDataCallback,
  SysStatusCallback, RadioCallback, MissionProgressCallback,
  EkfCallback, VibrationCallback, ServoOutputCallback,
  WindCallback, TerrainCallback,
  MagCalProgressCallback, MagCalReportCallback,
  AccelCalPosCallback,
  HomePositionCallback, AutopilotVersionCallback,
  PowerStatusCallback, DistanceSensorCallback, FenceStatusCallback,
  NavControllerCallback, ScaledImuCallback, ScaledPressureCallback,
  EstimatorStatusCallback, CameraTriggerCallback, LinkStateCallback,
  LocalPositionCallback, DebugCallback, GimbalAttitudeCallback,
  ObstacleDistanceCallback, AdsbVehicleCallback, CameraImageCapturedCallback,
  ExtendedSysStateCallback, FencePointCallback, SystemTimeCallback,
  RawImuCallback, RcChannelsRawCallback, RcChannelsOverrideCallback,
  MissionItemCallback, AltitudeCallback, WindCovCallback,
  AisVesselCallback, GimbalManagerInfoCallback, GimbalManagerStatusCallback,
  CanFrameCallback, CanFdFrameCallback,
  OpticalFlowCallback, OpticalFlowRadCallback, OdometryCallback,
  VisionPositionEstimateCallback, VisionPositionDeltaCallback,
} from './callbacks';
import type { MissionItem, LogEntry, LogDownloadProgressCallback, FtpDownloadProgressCallback, FenceElement } from './mission';
import type { FirmwareHandler } from './firmware';
import type { MAVLinkFrame } from '../mavlink-parser';
// iNav-specific types : optional so MAVLink adapter needs no changes
import type {
  INavSafehome, INavGeozone, INavGeozoneVertex,
  INavActiveProfiles, INavBatteryConfig, INavMixer, INavServoConfig,
  INavMcBraking, INavRateDynamics, INavTimerOutputModeEntry, INavOutputMappingExt2Entry,
  INavTempSensorConfigEntry, INavCalibrationData, INavLogicCondition,
  INavGvarStatus, INavProgrammingPid, INavProgrammingPidStatus,
  INavEzTune, INavFwApproach, INavOsdAlarms, INavOsdPreferences, INavOsdLayoutsHeader,
  INavCustomOsdElement, INavCustomOsdElementsInfo,
  MotorMixerRule, INavServoMixerRule,
} from '../msp/msp-decoders-inav';
// Name-based settings surface (iNav). types → msp is the existing import
// direction (see the iNav decoders import above), so this introduces no cycle.
import type { SettingInfo, SettingValue } from '../msp/settings';
// Betaflight serial-port config shape (MSP_CF_SERIAL_CONFIG).
import type { MspSerialPort } from '../msp/decoders/config/serial';
// Betaflight OSD config shape (MSP_OSD_CONFIG).
import type { MspOsdConfig, MspOsdGeneralConfig } from '../msp/decoders/config/osd';
// Betaflight receiver config shape (MSP_RX_CONFIG).
import type { BfRxConfig } from '../msp/decoders/config/rx';
import type { HsvColor, BfLedModeColor } from '../msp/decoders/config/led';
import type { DisplayPortOp } from '../msp/decoders/config/displayport';
import type { MspModeBox, MspModeRange, MspAdjustmentRange } from '../msp/msp-decoders-status';
import type { MspVtxTablePowerLevel } from '../msp/msp-decoders-ext';

// Re-export the settings value/metadata shapes so consumers can import them
// from the protocol contract barrel rather than reaching into the MSP layer.
export type { SettingInfo, SettingValue } from '../msp/settings';
export { settingNumber } from '../msp/settings';
export type { MspSerialPort } from '../msp/decoders/config/serial';
export type { MspOsdConfig, MspOsdGeneralConfig } from '../msp/decoders/config/osd';
export type { BfRxConfig } from '../msp/decoders/config/rx';
export type { HsvColor, BfLedModeColor } from '../msp/decoders/config/led';
export type { MspModeBox, MspModeRange, MspAdjustmentRange } from '../msp/msp-decoders-status';

/**
 * Name-indexed FC settings surface (the iNav MSP2_COMMON_SETTING family).
 *
 * Present only on firmwares that expose name-addressed settings (iNav).
 * MAVLink firmwares (ArduPilot, PX4) leave `DroneProtocol.settings`
 * undefined — they configure through the numeric parameter surface instead.
 */
export interface SettingsCapability {
  /** Read a named setting, decoded into its typed value. */
  getSetting(name: string): Promise<SettingValue>;
  /** Write a named setting from a typed value. */
  setSetting(name: string, value: number | string): Promise<CommandResult>;
  /** Fetch metadata (type, range, enum labels, current value) for a named setting. */
  getSettingInfo(name: string): Promise<SettingInfo>;
  /** Enumerate every named setting the FC exposes. */
  enumerate(): Promise<SettingInfo[]>;
}

/** One firmware setting read from the CLI: name + raw text value. */
export interface CliSetting {
  name: string;
  value: string;
}

/** A staged CLI setting change (name + new raw text value). */
export interface CliSettingChange {
  name: string;
  value: string;
}

/**
 * Text-CLI settings surface (the Betaflight `#` CLI: `get` / `set` / `dump` /
 * `save`). Present only on firmwares that expose their full settings solely
 * through the CLI because they have no name-based introspection protocol
 * (Betaflight). iNav uses the typed `settings` capability instead; MAVLink
 * firmwares leave both undefined.
 */
export interface CliSettingsCapability {
  /** Enter the CLI, `dump` every setting's current value, exit (no reboot). */
  enumerate(): Promise<CliSetting[]>;
  /** Read one setting's current value (`get <name>`). */
  getSetting(name: string): Promise<string | undefined>;
  /**
   * Apply staged changes in one CLI session (`set name = value`). Persists to
   * EEPROM via `save noreboot` when `persist` is set; neither path reboots.
   */
  applySettings(changes: CliSettingChange[], opts?: { persist?: boolean }): Promise<CommandResult>;
}

/**
 * Top-level protocol interface that the GCS talks to.
 *
 * Implementations (MAVLink, future MSP) fulfill this contract.
 * The Zustand `DroneManager` store holds a `DroneProtocol` per
 * connected vehicle and bridges telemetry callbacks into reactive
 * store state.
 */
/** Public link info exposed to the UI for multi-link displays. */
export interface LinkInfo {
  id: string;
  type: Transport['type'];
  label: string;
  isConnected: boolean;
  connectedAt: number;
  lastByteAt: number;
  isPrimary: boolean;
}

/** One entry from a MAVLink FTP ListDirectory response. */
export interface FtpDirEntry {
  name: string;
  /** File size in bytes (0 for directories). */
  size: number;
  isDir: boolean;
}

/** Options for {@link DroneProtocol.guidedGoto}. */
export interface GuidedGotoOptions {
  /**
   * Switch the vehicle into its guided mode as part of the reposition
   * (MAV_DO_REPOSITION_FLAGS_CHANGE_MODE). Defaults to true.
   */
  changeMode?: boolean;
}

export interface DroneProtocol {
  readonly protocolName: string;

  // ── Connection ──────────────────────────────────────────
  connect(transport: Transport): Promise<VehicleInfo>;
  disconnect(): Promise<void>;
  readonly isConnected: boolean;

  // ── Multi-Link (optional) ───────────────────────────────
  /** Add an additional transport as a link. Validates sysid match. */
  addLink?(transport: Transport): Promise<{ ok: true; linkId: string } | { ok: false; error: string }>;
  /** Remove a link by id. If it's the last link, the protocol disconnects. */
  removeLink?(linkId: string): Promise<void>;
  /** Information about all active links for this drone. */
  readonly linkInfo?: LinkInfo[];

  // ── Commands ────────────────────────────────────────────
  arm(): Promise<CommandResult>;
  disarm(): Promise<CommandResult>;
  setFlightMode(mode: UnifiedFlightMode): Promise<CommandResult>;
  returnToLaunch(): Promise<CommandResult>;
  /** Land. `at` is sent with the command, but ArduPilot ignores it and lands
   *  in place; a surface that lands somewhere else repositions first and
   *  calls this once the vehicle is holding over the point. */
  land(at?: { lat: number; lon: number }): Promise<CommandResult>;
  takeoff(altitude: number): Promise<CommandResult>;
  /**
   * Flight termination. Irreversible in flight. `confirmed` must carry a real
   * operator confirmation; the protocol layer refuses without it rather than
   * guessing that a bare click meant it.
   */
  killSwitch(confirmed: boolean): Promise<CommandResult>;
  /**
   * Reposition to a point (MAV_CMD_DO_REPOSITION). By default the vehicle is
   * also switched into its guided mode; `changeMode: false` sends the
   * reposition without that flag, so a stream of updates never pulls a vehicle
   * back out of a mode the pilot or a failsafe chose.
   */
  guidedGoto(lat: number, lon: number, alt: number, options?: GuidedGotoOptions): Promise<CommandResult>;
  pauseMission(): Promise<CommandResult>;
  resumeMission(): Promise<CommandResult>;
  clearMission(): Promise<CommandResult>;
  commitParamsToFlash(): Promise<CommandResult>;

  // ── Field Operations ──────────────────────────────────────
  setHome(useCurrent: boolean, lat?: number, lon?: number, alt?: number): Promise<CommandResult>;
  changeSpeed(speedType: number, speed: number): Promise<CommandResult>;
  setYaw(angle: number, speed: number, direction: number, relative: boolean): Promise<CommandResult>;
  setGeoFenceEnabled(enabled: boolean): Promise<CommandResult>;
  setServo(servoNumber: number, pwm: number): Promise<CommandResult>;
  cameraTrigger(): Promise<CommandResult>;
  setGimbalAngle(pitch: number, roll: number, yaw: number): Promise<CommandResult>;
  /**
   * Ask the FC for its pre-arm verdict. Over MAVLink, success means the FC
   * accepted MAV_CMD_RUN_PREARM_CHECKS and ran them; any failures arrive
   * afterwards as STATUSTEXT, and the SYS_STATUS pre-arm bit carries the
   * verdict. Over MSP the arming-disable word is read directly, so success
   * means no blocker is set and a failure message names the blockers.
   */
  doPreArmCheck(): Promise<CommandResult>;

  // ── Fence Operations ──────────────────────────────────────
  uploadFence?(points: Array<{ lat: number; lon: number }>): Promise<CommandResult>;
  downloadFence?(): Promise<Array<{ idx: number; lat: number; lon: number }>>;
  /**
   * Upload the geofence as a fence-type mission (mission_type = fence). Used by
   * firmwares (PX4) that store the fence as a mission plan rather than the
   * legacy FENCE_POINT protocol.
   */
  uploadFenceMission?(elements: FenceElement[]): Promise<CommandResult>;
  /** Download the geofence as a fence-type mission and reassemble the model. */
  downloadFenceMission?(): Promise<FenceElement[]>;

  // ── Rally Point Operations ───────────────────────────────
  uploadRallyPoints?(points: Array<{ lat: number; lon: number; alt: number }>): Promise<CommandResult>;
  downloadRallyPoints?(): Promise<Array<{ lat: number; lon: number; alt: number }>>;

  // ── iNav Navigation Features ──────────────────────────────
  uploadSafehomes?(safehomes: INavSafehome[]): Promise<CommandResult>;
  downloadSafehomes?(): Promise<INavSafehome[]>;
  uploadGeozones?(zones: INavGeozone[], vertices: INavGeozoneVertex[]): Promise<CommandResult>;
  downloadGeozones?(): Promise<{ zones: INavGeozone[]; vertices: INavGeozoneVertex[] }>;

  // ── iNav Configuration ────────────────────────────────────
  getBatteryConfig?(): Promise<INavBatteryConfig>;
  setBatteryConfig?(cfg: INavBatteryConfig): Promise<CommandResult>;
  selectBatteryProfile?(idx: number): Promise<CommandResult>;
  /** The control, battery and mixer profiles the FC is flying (MSP2_INAV_STATUS). */
  getActiveProfiles?(): Promise<INavActiveProfiles>;
  /** Switch the control profile (MSP_SELECT_SETTING); the FC refuses while armed. */
  selectControlProfile?(idx: number): Promise<CommandResult>;
  getMixerConfig?(): Promise<INavMixer>;
  selectMixerProfile?(idx: number): Promise<CommandResult>;
  getOutputMapping?(): Promise<INavOutputMappingExt2Entry[]>;
  getTimerOutputModes?(): Promise<INavTimerOutputModeEntry[]>;
  setTimerOutputMode?(entries: INavTimerOutputModeEntry[]): Promise<CommandResult>;
  getServoConfigs?(): Promise<INavServoConfig[]>;
  /** Write every servo's config (index = array position), then save to EEPROM. */
  setServoConfigs?(cfgs: INavServoConfig[]): Promise<CommandResult>;
  getTempSensorConfigs?(): Promise<INavTempSensorConfigEntry[]>;
  /** Live temperature per sensor slot in tenths of a degree C; null = no valid reading (iNav). */
  getTemperatures?(): Promise<(number | null)[]>;
  /** Accelerometer six-point progress and compass offsets (iNav MSP_CALIBRATION_DATA). */
  getCalibrationData?(): Promise<INavCalibrationData>;
  getMcBraking?(): Promise<INavMcBraking>;
  setMcBraking?(b: INavMcBraking): Promise<CommandResult>;
  getRateDynamics?(): Promise<INavRateDynamics>;
  setRateDynamics?(r: INavRateDynamics): Promise<CommandResult>;
  getEzTune?(): Promise<INavEzTune>;
  setEzTune?(cfg: INavEzTune): Promise<CommandResult>;
  getFwApproach?(): Promise<INavFwApproach[]>;
  setFwApproach?(a: INavFwApproach): Promise<CommandResult>;
  getOsdLayoutsHeader?(): Promise<INavOsdLayoutsHeader>;
  getOsdAlarms?(): Promise<INavOsdAlarms>;
  setOsdAlarms?(a: INavOsdAlarms): Promise<CommandResult>;
  getOsdPreferences?(): Promise<INavOsdPreferences>;
  setOsdPreferences?(p: INavOsdPreferences): Promise<CommandResult>;
  getCustomOsdElements?(): Promise<{ info: INavCustomOsdElementsInfo; elements: INavCustomOsdElement[] }>;
  setCustomOsdElement?(el: INavCustomOsdElement): Promise<CommandResult>;

  // ── iNav Name-Based Settings (optional) ───────────────────
  /**
   * Name-indexed settings surface. Defined only on firmwares that expose
   * named settings (iNav); undefined on MAVLink firmwares.
   */
  settings?: SettingsCapability;

  /**
   * Text-CLI settings surface. Defined only on firmwares whose full settings
   * are reachable solely over the CLI (Betaflight); undefined elsewhere.
   */
  cliSettings?: CliSettingsCapability;

  /**
   * Subscribe to every inbound MAVLink frame after the link's parser has
   * reassembled it across chunks, checked its CRC and stripped any signature.
   * Defined only on MAVLink links; undefined on MSP.
   */
  onMavlinkFrame?(callback: (frame: MAVLinkFrame) => void): () => void;

  // ── Betaflight binary config (MSP) ────────────────────────
  /** Read the per-UART serial-port configuration (Betaflight). */
  getSerialConfig?(): Promise<MspSerialPort[]>;
  /** Write the per-UART serial-port configuration (Betaflight). */
  setSerialConfig?(ports: MspSerialPort[]): Promise<CommandResult>;
  /** Whether the last serial read carried the 32-bit MSP2 function mask (bits > 15). */
  serialConfigExtended?(): boolean;
  /** Send a DShot special command to an ESC (beacon / spin direction / 3D / save). Disarmed-only (Betaflight). */
  sendDshotCommand?(commandType: number, motorIndex: number, commands: number[]): Promise<CommandResult>;
  /** Test a single actuator output (PX4). functionCode = ACTUATOR_OUTPUT_FUNCTION, value -1..1 (NaN=stop), timeoutS auto-restores. Disarmed-only. */
  actuatorTest?(functionCode: number, value: number, timeoutS: number): Promise<CommandResult>;
  /** Read the OSD config: video system, alarms, per-element positions (Betaflight). */
  getOsdConfig?(): Promise<MspOsdConfig>;
  /** Write the OSD layout: optional general settings, then each element position (Betaflight). */
  writeOsdLayout?(items: Array<{ index: number; position: number }>, general?: MspOsdGeneralConfig): Promise<CommandResult>;
  /** Upload a MAX7456 character font, one glyph per MSP_OSD_CHAR_WRITE (Betaflight). */
  uploadOsdFont?(glyphs: Uint8Array[], onProgress?: (done: number, total: number) => void): Promise<CommandResult>;
  /** Read the onboard blackbox flash summary: total and used bytes, ready state (Betaflight). */
  getDataflashSummary?(): Promise<{ totalSize: number; usedSize: number; ready: boolean }>;
  /** Download the logged part of the onboard blackbox flash; empty when nothing is logged (Betaflight). */
  downloadBlackbox?(onProgress?: (p: { percentComplete: number }) => void): Promise<Uint8Array>;
  /** Erase the onboard blackbox flash, resolving once the FC reports it empty (Betaflight). */
  eraseDataflash?(): Promise<void>;
  /** Read the per-LED packed strip config (Betaflight). */
  getLedStripConfig?(): Promise<number[]>;
  /** Write the per-LED packed strip config, one MSP write per LED (Betaflight). */
  setLedStripConfig?(leds: number[]): Promise<CommandResult>;
  /** Read the 16-entry configurable HSV colour palette (Betaflight). */
  getLedColors?(): Promise<HsvColor[]>;
  /** Write the 16-entry HSV colour palette (Betaflight). */
  setLedColors?(colors: HsvColor[]): Promise<CommandResult>;
  /** Read the mode/special/aux colour assignments (Betaflight). */
  getLedStripModeColors?(): Promise<BfLedModeColor[]>;
  /** Set mode colours by (mode, function), then save to EEPROM (Betaflight). */
  setLedStripModeColors?(entries: BfLedModeColor[]): Promise<CommandResult>;
  /** Subscribe to pushed MSP DisplayPort OSD frames (Betaflight / iNav). */
  onDisplayPort?(cb: (op: DisplayPortOp) => void): () => void;
  /** Read the receiver config: provider, stick range, deadband (Betaflight). */
  getRxConfig?(): Promise<BfRxConfig>;
  /** Write the receiver config (Betaflight). */
  setRxConfig?(cfg: BfRxConfig): Promise<CommandResult>;
  /** Read the RC channel map (Betaflight). */
  getRxMap?(): Promise<number[]>;
  /** Write the RC channel map (Betaflight). */
  setRxMap?(map: number[]): Promise<CommandResult>;
  /** Read the VTX table power levels; `BF_VTX_POWER` indexes them from 1. Empty without a VTX table (Betaflight). */
  getVtxPowerLevels?(): Promise<MspVtxTablePowerLevel[]>;

  // ── iNav Programming Framework ────────────────────────────
  downloadLogicConditions?(): Promise<INavLogicCondition[]>;
  /** Write every logic condition (index = array position), then save to EEPROM. */
  uploadLogicConditions?(rules: INavLogicCondition[]): Promise<CommandResult>;
  /** Live value of every logic condition, by slot. */
  downloadLogicConditionsStatus?(): Promise<number[]>;
  downloadGvarStatus?(): Promise<INavGvarStatus>;
  /** Set one global variable's live runtime value (iNav). */
  setGvar?(index: number, value: number): Promise<CommandResult>;
  downloadProgrammingPids?(): Promise<INavProgrammingPid[]>;
  /** Write every programming PID (index = array position), then save to EEPROM. */
  uploadProgrammingPids?(rules: INavProgrammingPid[]): Promise<CommandResult>;
  downloadProgrammingPidStatus?(): Promise<INavProgrammingPidStatus[]>;
  downloadMotorMixer?(): Promise<MotorMixerRule[]>;
  uploadMotorMixer?(rules: MotorMixerRule[]): Promise<void>;
  downloadServoMixer?(): Promise<INavServoMixerRule[]>;
  uploadServoMixer?(rules: INavServoMixerRule[]): Promise<void>;

  // ── Mode and adjustment ranges (Betaflight / iNav) ─────────
  /** The modes the FC offers, by permanent box id (MSP_BOXNAMES + MSP_BOXIDS). */
  getModeBoxes?(): Promise<MspModeBox[]>;
  /** Every mode-range slot in slot order, empty ones included (start >= end). */
  getModeRanges?(): Promise<MspModeRange[]>;
  /**
   * Write `ranges` to slots 0..n-1, clear the remaining slots, then save to
   * EEPROM. Fails when any slot write or the save fails.
   */
  setModeRanges?(ranges: MspModeRange[]): Promise<CommandResult>;
  /** Every adjustment-range slot in slot order, empty ones included. */
  getAdjustmentRanges?(): Promise<MspAdjustmentRange[]>;
  /** Same slot semantics as `setModeRanges`, for adjustment ranges. */
  setAdjustmentRanges?(ranges: MspAdjustmentRange[]): Promise<CommandResult>;

  // ── Guided Flight ─────────────────────────────────────────
  sendPositionTarget?(lat: number, lon: number, alt: number): void;
  sendAttitudeTarget?(roll: number, pitch: number, yaw: number, thrust: number): void;

  // ── Fence Enable ─────────────────────────────────────────
  enableFence?(enable: boolean): Promise<CommandResult>;

  // ── Landing / Relay / Video / RX Pair ───────────────────
  doLandStart?(): Promise<CommandResult>;
  controlVideo?(params: { cameraId: number; transmission: number; channel: number; recording: number }): Promise<CommandResult>;
  setRelay?(relayNum: number, on: boolean): Promise<CommandResult>;
  startRxPair?(spektrum: number): Promise<CommandResult>;

  // ── Camera/Gimbal ─────────────────────────────────────────
  setCameraTriggerDistance?(distance: number): Promise<CommandResult>;
  setGimbalMode?(mode: number): Promise<CommandResult>;
  setGimbalROI?(lat: number, lon: number, alt: number): Promise<CommandResult>;
  setRoiLocation?(lat: number, lon: number, alt: number): Promise<CommandResult>;
  clearRoi?(): Promise<CommandResult>;

  // ── Orbit ────────────────────────────────────────────────
  orbit?(radius: number, velocity: number, yawBehavior: number, lat: number, lon: number, alt: number): Promise<CommandResult>;

  // ── EKF ──────────────────────────────────────────────────
  setEkfOrigin?(lat: number, lon: number, alt: number): Promise<CommandResult>;
  /**
   * Switch the active EKF source set on the flight controller at runtime.
   *
   * ArduPilot: fires MAV_CMD_SET_EKF_SOURCE_SET (42007) and resolves on the
   * COMMAND_ACK or 1 s timeout.
   *
   * PX4 has no runtime equivalent. Switching source sets requires a
   * parameter update plus an EKF restart. Implementations should warn and
   * resolve with `{ ok: false, reason: "px4-not-supported" }` rather than
   * throwing, so the caller can render the right UX.
   */
  setEkfSourceSet(sourceSet: 1 | 2 | 3): Promise<{ ok: true } | { ok: false; reason: "px4-not-supported" | "no-ack" | "rejected" }>;

  // ── Advanced Calibration ──────────────────────────────────
  startEscCalibration?(): Promise<CommandResult>;

  // ── Manual Control ──────────────────────────────────────
  /**
   * Send one normalized stick frame at up to 50 Hz. Fire-and-forget (no ACK).
   *
   * `roll`, `pitch`, and `yaw` are -1..1 with 0 at center. `throttle` is a
   * deliberately different range, 0..1 with 0 at idle: on an MSP flight
   * controller the center of a bipolar range is half throttle, so a throttle
   * that shares the stick scale idles the aircraft at half power.
   */
  sendManualControl(
    roll: number,
    pitch: number,
    throttle: number,
    yaw: number,
    buttons: number,
  ): void;

  /**
   * Why this link cannot carry stick frames, in operator-readable terms, or
   * null when it can.
   *
   * `sendManualControl` is fire-and-forget, so a link that refuses every frame
   * refuses them silently. This is how that refusal reaches a surface. Absent
   * on links that have no such condition.
   */
  getManualControlBlockedReason?(): string | null;

  // ── Parameters ──────────────────────────────────────────
  getAllParameters(): Promise<ParameterValue[]>;
  getParameter(name: string): Promise<ParameterValue>;
  /**
   * Write one parameter. The MAV_PARAM_TYPE (and, on firmware that packs
   * integers bytewise, the value encoding) comes from the vehicle's own last
   * report of the parameter, never from the caller.
   */
  setParameter(name: string, value: number): Promise<CommandResult>;
  resetParametersToDefault(): Promise<CommandResult>;
  /** Return cached parameter names (from last getAllParameters download). Empty if not yet downloaded. */
  getCachedParameterNames(): string[];

  // ── Mission ─────────────────────────────────────────────
  uploadMission(items: MissionItem[]): Promise<CommandResult>;
  downloadMission(): Promise<MissionItem[]>;
  setCurrentMissionItem(seq: number): Promise<CommandResult>;

  // ── Log Download ────────────────────────────────────────
  /** Request list of on-board logs. */
  getLogList(): Promise<LogEntry[]>;
  /** Download a log by ID, with optional progress callback. Returns raw binary data. */
  downloadLog(logId: number, onProgress?: LogDownloadProgressCallback): Promise<Uint8Array>;
  /** Erase all on-board logs. */
  eraseAllLogs(): Promise<CommandResult>;
  /** Cancel an in-progress log download. */
  cancelLogDownload(): void;

  /**
   * Download a file from the vehicle over MAVLink FTP (read-only).
   * Optional: only MAVLink transports implement it. Returns the raw file bytes.
   */
  downloadFileViaFtp?(path: string, onProgress?: FtpDownloadProgressCallback): Promise<Uint8Array>;

  /**
   * Upload `bytes` to `path` on the vehicle over MAVLink FTP (create/overwrite).
   * Deliberate operator action (e.g. Lua script upload). Optional: MAVLink only.
   */
  uploadFileViaFtp?(path: string, bytes: Uint8Array, onProgress?: (written: number, total: number) => void): Promise<void>;

  /** List a directory on the vehicle over MAVLink FTP. Optional: MAVLink only. */
  listDirectoryViaFtp?(path: string): Promise<FtpDirEntry[]>;

  /** Remove a file on the vehicle over MAVLink FTP. Optional: MAVLink only. */
  removeFileViaFtp?(path: string): Promise<void>;

  /**
   * The FC-served component metadata URI, once COMPONENT_METADATA has been
   * received (requested once at connect, PX4 only). Null until the frame
   * arrives, or if the vehicle never sends one. Optional: only MAVLink
   * transports implement it.
   */
  getComponentMetadataUri?(): string | null;

  // ── Calibration ─────────────────────────────────────────
  startCalibration(
    type: "accel" | "gyro" | "compass" | "level" | "airspeed" | "baro" | "rc" | "esc" | "compassmot",
  ): Promise<CommandResult>;
  /** Send COMMAND_LONG(42429) to confirm accel cal position (fire-and-forget). */
  confirmAccelCalPos?(position: number): void;
  /** Send DO_ACCEPT_MAG_CAL (42425). compassMask=0 means all. */
  acceptCompassCal?(compassMask?: number): Promise<CommandResult>;
  /** Send DO_CANCEL_MAG_CAL (42426). compassMask=0 means all. */
  cancelCompassCal?(compassMask?: number): Promise<CommandResult>;
  /** Send PREFLIGHT_CALIBRATION with all zeros to cancel any active non-compass calibration. */
  cancelCalibration?(): Promise<CommandResult>;
  /**
   * MAV_CMD_FIXED_MAG_CAL_YAW (42006): calibrate the compass from the world
   * magnetic model and the vehicle's KNOWN earth-frame yaw in degrees (0-359),
   * which the operator supplies. ArduPilot and PX4 both implement it.
   */
  startGnssMagCal?(yawDeg: number): Promise<CommandResult>;
  /** Send a generic MAV_CMD command. Use for commands without a dedicated method. */
  sendCommand?(commandId: number, params: number[]): Promise<CommandResult>;

  // ── Motor Test ──────────────────────────────────────────
  motorTest(motor: number, throttle: number, duration: number): Promise<CommandResult>;
  /**
   * Bench-test every motor output at once: `throttlesPct[i]` percent for
   * output i in a single frame, idled by the adapter after `durationSeconds`.
   * An all-zero vector is the stop and is accepted even while armed; any other
   * vector needs a positive duration and a disarmed vehicle. MSP only.
   */
  setMotorTestOutputs?(throttlesPct: readonly number[], durationSeconds: number): Promise<CommandResult>;

  // ── Reboot ──────────────────────────────────────────────
  rebootToBootloader(): Promise<CommandResult>;
  reboot(): Promise<CommandResult>;

  // ── Telemetry Subscriptions ─────────────────────────────
  // Each returns an unsubscribe function.
  onAttitude(callback: AttitudeCallback): () => void;
  onPosition(callback: PositionCallback): () => void;
  onBattery(callback: BatteryCallback): () => void;
  onGps(callback: GpsCallback): () => void;
  onVfr(callback: VfrCallback): () => void;
  onRc(callback: RcCallback): () => void;
  onStatusText(callback: StatusTextCallback): () => void;
  /** PX4 structured events (MAVLink EVENT msg 410). Text is resolved from the
   * events component-metadata; firmwares without the events interface never
   * emit these. */
  onEvent(callback: EventCallback): () => void;
  onHeartbeat(callback: HeartbeatCallback): () => void;
  onParameter(callback: ParameterCallback): () => void;
  onSerialData(callback: SerialDataCallback): () => void;
  onSysStatus(callback: SysStatusCallback): () => void;
  onRadio(callback: RadioCallback): () => void;
  onMissionProgress(callback: MissionProgressCallback): () => void;
  onEkf(callback: EkfCallback): () => void;
  onVibration(callback: VibrationCallback): () => void;
  onServoOutput(callback: ServoOutputCallback): () => void;
  onWind(callback: WindCallback): () => void;
  onTerrain(callback: TerrainCallback): () => void;
  onMagCalProgress?(callback: MagCalProgressCallback): () => void;
  onMagCalReport?(callback: MagCalReportCallback): () => void;
  onAccelCalPos?(callback: AccelCalPosCallback): () => void;
  onHomePosition?(callback: HomePositionCallback): () => void;
  onAutopilotVersion?(callback: AutopilotVersionCallback): () => void;
  onPowerStatus?(callback: PowerStatusCallback): () => void;
  onDistanceSensor?(callback: DistanceSensorCallback): () => void;
  onFenceStatus?(callback: FenceStatusCallback): () => void;
  onNavController?(callback: NavControllerCallback): () => void;
  onScaledImu?(callback: ScaledImuCallback): () => void;
  onScaledPressure?(callback: ScaledPressureCallback): () => void;
  onEstimatorStatus?(callback: EstimatorStatusCallback): () => void;
  onCameraTrigger?(callback: CameraTriggerCallback): () => void;
  onLinkLost?(callback: LinkStateCallback): () => void;
  onLinkRestored?(callback: LinkStateCallback): () => void;
  onLocalPosition?(callback: LocalPositionCallback): () => void;
  onDebug?(callback: DebugCallback): () => void;
  onGimbalAttitude?(callback: GimbalAttitudeCallback): () => void;
  onObstacleDistance?(callback: ObstacleDistanceCallback): () => void;
  /** ADS-B traffic contacts (ADSB_VEHICLE), one call per received contact. */
  onAdsbVehicle?(callback: AdsbVehicleCallback): () => void;
  onCameraImageCaptured?(callback: CameraImageCapturedCallback): () => void;
  onExtendedSysState?(callback: ExtendedSysStateCallback): () => void;
  onFencePoint?(callback: FencePointCallback): () => void;
  onSystemTime?(callback: SystemTimeCallback): () => void;
  onRawImu?(callback: RawImuCallback): () => void;
  onRcChannelsRaw?(callback: RcChannelsRawCallback): () => void;
  onRcChannelsOverride?(callback: RcChannelsOverrideCallback): () => void;
  onMissionItem?(callback: MissionItemCallback): () => void;
  onAltitude?(callback: AltitudeCallback): () => void;
  onWindCov?(callback: WindCovCallback): () => void;
  onAisVessel?(callback: AisVesselCallback): () => void;
  onGimbalManagerInfo?(callback: GimbalManagerInfoCallback): () => void;
  onGimbalManagerStatus?(callback: GimbalManagerStatusCallback): () => void;
  onCanFrame?(callback: CanFrameCallback): () => void;
  onCanFdFrame?(callback: CanFdFrameCallback): () => void;

  // ── CAN passthrough ──────────────────────────────────────
  /** Enable MAVLink CAN_FORWARD on the given bus (1 or 2; 0 disables). */
  enableCanForward?(bus: number): Promise<CommandResult>;
  /** Send a raw CAN_FRAME (msg 386) on the given bus. Fire-and-forget. */
  sendCanFrame?(bus: number, id: number, data: Uint8Array): void;
  /** Send a raw CANFD_FRAME (msg 387) on the given bus. Fire-and-forget. */
  sendCanFdFrame?(bus: number, id: number, data: Uint8Array): void;
  onOpticalFlow?(callback: OpticalFlowCallback): () => void;
  onOpticalFlowRad?(callback: OpticalFlowRadCallback): () => void;
  onOdometry?(callback: OdometryCallback): () => void;
  onVisionPositionEstimate?(callback: VisionPositionEstimateCallback): () => void;
  onVisionPositionDelta?(callback: VisionPositionDeltaCallback): () => void;

  // ── Serial Passthrough ──────────────────────────────────
  /** Send a string as SERIAL_CONTROL data to the FC shell. */
  sendSerialData(text: string): void;

  // ── Message Rate Control ────────────────────────────────
  /** Request a single message by ID (MAV_CMD_REQUEST_MESSAGE = 512). */
  requestMessage?(msgId: number): Promise<CommandResult>;
  /** Set streaming interval for a message (MAV_CMD_SET_MESSAGE_INTERVAL = 511). */
  setMessageInterval?(msgId: number, intervalUs: number): Promise<CommandResult>;

  // ── Info ─────────────────────────────────────────────────
  getVehicleInfo(): VehicleInfo | null;
  getCapabilities(): ProtocolCapabilities;
  getFirmwareHandler(): FirmwareHandler | null;
}
