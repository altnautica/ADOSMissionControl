/**
 * DroneProtocol members for the vehicle's stored state and maintenance:
 * parameters, missions, log download, calibration, motor test, reboot,
 * serial passthrough, message rates, info and diagnostics.
 *
 * @module protocol/types/protocol/vehicle-io
 */

import type { VehicleInfo, CommandResult, ParameterValue, ProtocolCapabilities } from '../core';
import type { MissionItem, LogEntry, LogDownloadProgressCallback, FtpDownloadProgressCallback, MissionUploadProgressCallback } from '../mission';
import type { FtpDirEntry, CommandQueueSnapshot } from './base';
import type { FirmwareHandler } from '../firmware';

/** Stored-state and maintenance members of {@link DroneProtocol}. */
export interface DroneProtocolVehicleIo {
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
  /** Upload a mission; `onProgress` hears how many items the vehicle has taken so far. */
  uploadMission(items: MissionItem[], onProgress?: MissionUploadProgressCallback): Promise<CommandResult>;
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

  // ── Diagnostics ──────────────────────────────────────────
  /** Snapshot of commands awaiting COMMAND_ACK. */
  getCommandQueueSnapshot?(): CommandQueueSnapshot;
  /** Toggle per-frame hex logging into the diagnostics store. */
  setDiagnosticsEnabled?(enabled: boolean): void;
}
