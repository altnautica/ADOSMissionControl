/**
 * Core DroneProtocol members: connection, commands, parameters, missions, logs, calibration and info.
 *
 * @module protocol/types/protocol/base
 */

import type { Transport } from '../transport';
import type { UnifiedFlightMode } from '../enums';
import type { VehicleInfo, CommandResult, ParameterValue, ProtocolCapabilities } from '../core';
import type { MissionItem, LogEntry, LogDownloadProgressCallback, FtpDownloadProgressCallback, FenceElement, RallyPointItem } from '../mission';
import type { FirmwareHandler } from '../firmware';

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

/** Pending-command view returned by {@link DroneProtocol.getCommandQueueSnapshot}. */
export interface CommandQueueSnapshot {
  pendingCount: number;
  entries: { ticket: number; command: number; retryCount: number; sentAt: number }[];
}

/** Core members of {@link DroneProtocol}. */
export interface DroneProtocolBase {
  readonly protocolName: string;

  // ── Connection ──────────────────────────────────────────
  connect(transport: Transport): Promise<VehicleInfo>;
  disconnect(): Promise<void>;
  readonly isConnected: boolean;
  /**
   * Fires once when the protocol loses its last link (or is disconnected).
   * The protocol, not any one transport, is the source of truth for whether
   * a multi-link drone is still reachable. Returns an unsubscribe function.
   */
  onDisconnect?(cb: () => void): () => void;

  // ── Multi-Link (optional) ───────────────────────────────
  /** Add an additional transport as a link. Validates sysid match. */
  addLink?(transport: Transport): Promise<{ ok: true; linkId: string } | { ok: false; error: string }>;
  /** Remove a link by id. If it's the last link, the protocol disconnects. */
  removeLink?(linkId: string): Promise<void>;
  /** Information about all active links for this drone. */
  readonly linkInfo?: LinkInfo[];
  /** The link outbound frames go through (prefers one that can command). */
  readonly commandTransport?: Transport | null;

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
  /**
   * Upload the geofence as a fence-type mission (mission_type = fence). An
   * empty element list uploads a count of 0, which clears the vehicle's fence.
   */
  uploadFenceMission?(elements: FenceElement[]): Promise<CommandResult>;
  /** Download the geofence as a fence-type mission and reassemble the model. */
  downloadFenceMission?(): Promise<FenceElement[]>;

  // ── Rally Point Operations ───────────────────────────────
  uploadRallyPoints?(points: RallyPointItem[]): Promise<CommandResult>;
  /** Each point with the MAV_FRAME its altitude was stored in. */
  downloadRallyPoints?(): Promise<RallyPointItem[]>;

  // ── Fence Enable ─────────────────────────────────────────
  enableFence?(enable: boolean): Promise<CommandResult>;

  // ── Landing / Relay / Video / RX Pair ───────────────────
  doLandStart?(): Promise<CommandResult>;
  controlVideo?(params: { cameraId: number; transmission: number; channel: number; recording: number }): Promise<CommandResult>;
  setRelay?(relayNum: number, on: boolean): Promise<CommandResult>;
  startRxPair?(spektrum: number): Promise<CommandResult>;

  // ── Camera/Gimbal ─────────────────────────────────────────
  setGimbalMode?(mode: number): Promise<CommandResult>;
  setGimbalROI?(lat: number, lon: number, alt: number): Promise<CommandResult>;
  setRoiLocation?(lat: number, lon: number, alt: number): Promise<CommandResult>;
  clearRoi?(): Promise<CommandResult>;
  /**
   * One still image (MAV_CMD_IMAGE_START_CAPTURE), sent to the camera that
   * advertised itself in CAMERA_INFORMATION, else to the autopilot.
   */
  imageStartCapture?(): Promise<CommandResult>;
  /** One zoom step in (1) or out (-1) (MAV_CMD_SET_CAMERA_ZOOM, ZOOM_TYPE_STEP), same target. */
  setCameraZoom?(step: 1 | -1): Promise<CommandResult>;

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
