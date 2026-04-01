/**
 * Main DroneProtocol interface — the top-level API surface for the GCS.
 *
 * @module protocol/types/protocol
 */

import type { Transport } from './transport';
import type { UnifiedFlightMode } from './enums';
import type { VehicleInfo, CommandResult, ParameterValue, ProtocolCapabilities } from './core';
import type {
  AttitudeCallback, PositionCallback, BatteryCallback, GpsCallback,
  VfrCallback, RcCallback, StatusTextCallback, HeartbeatCallback,
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
  ObstacleDistanceCallback, CameraImageCapturedCallback,
  ExtendedSysStateCallback, FencePointCallback, SystemTimeCallback,
  RawImuCallback, RcChannelsRawCallback, RcChannelsOverrideCallback,
  MissionItemCallback, AltitudeCallback, WindCovCallback,
  AisVesselCallback, GimbalManagerInfoCallback, GimbalManagerStatusCallback,
} from './callbacks';
import type { MissionItem, LogEntry, LogDownloadProgressCallback } from './mission';
import type { FirmwareHandler } from './firmware';

/**
 * Top-level protocol interface that the GCS talks to.
 *
 * Implementations (MAVLink, future MSP) fulfill this contract.
 * The Zustand `DroneManager` store holds a `DroneProtocol` per
 * connected vehicle and bridges telemetry callbacks into reactive
 * store state.
 */
export interface DroneProtocol {
  readonly protocolName: string;

  // ── Connection ──────────────────────────────────────────
  connect(transport: Transport): Promise<VehicleInfo>;
  disconnect(): Promise<void>;
  readonly isConnected: boolean;

  // ── Commands ────────────────────────────────────────────
  arm(): Promise<CommandResult>;
  disarm(): Promise<CommandResult>;
  setFlightMode(mode: UnifiedFlightMode): Promise<CommandResult>;
  returnToLaunch(): Promise<CommandResult>;
  land(): Promise<CommandResult>;
  takeoff(altitude: number): Promise<CommandResult>;
  killSwitch(): Promise<CommandResult>;
  guidedGoto(lat: number, lon: number, alt: number): Promise<CommandResult>;
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
  doPreArmCheck(): Promise<CommandResult>;

  // ── Fence Operations ──────────────────────────────────────
  uploadFence?(points: Array<{ lat: number; lon: number }>): Promise<CommandResult>;
  downloadFence?(): Promise<Array<{ idx: number; lat: number; lon: number }>>;

  // ── Rally Point Operations ───────────────────────────────
  uploadRallyPoints?(points: Array<{ lat: number; lon: number; alt: number }>): Promise<CommandResult>;
  downloadRallyPoints?(): Promise<Array<{ lat: number; lon: number; alt: number }>>;

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

  // ── Advanced Calibration ──────────────────────────────────
  startEscCalibration?(): Promise<CommandResult>;
  startCompassMotCal?(): Promise<CommandResult>;

  // ── Manual Control ──────────────────────────────────────
  /** Send MANUAL_CONTROL at up to 50 Hz. Fire-and-forget (no ACK). */
  sendManualControl(
    roll: number,
    pitch: number,
    throttle: number,
    yaw: number,
    buttons: number,
  ): void;

  // ── Parameters ──────────────────────────────────────────
  getAllParameters(): Promise<ParameterValue[]>;
  getParameter(name: string): Promise<ParameterValue>;
  setParameter(name: string, value: number, type?: number): Promise<CommandResult>;
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
  /** PX4 only: Send MAV_CMD_FIXED_MAG_CAL_YAW (42006) to calibrate compass using GPS heading. */
  startGnssMagCal?(): Promise<CommandResult>;
  /** Send a generic MAV_CMD command. Use for commands without a dedicated method. */
  sendCommand?(commandId: number, params: number[]): Promise<CommandResult>;

  // ── Motor Test ──────────────────────────────────────────
  motorTest(motor: number, throttle: number, duration: number): Promise<CommandResult>;

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
