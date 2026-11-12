/**
 * MockProtocol — Full DroneProtocol implementation for demo mode.
 *
 * @license GPL-3.0-only
 */

import type {
  DroneProtocol, Transport, VehicleInfo, CommandResult, ParameterValue,
  ProtocolCapabilities, CommandQueueSnapshot, FirmwareHandler, MissionItem, UnifiedFlightMode,
  LogEntry, LogDownloadProgressCallback, FtpDownloadProgressCallback, AccelCalPosition, MissionUploadProgressCallback,
  SysStatusCallback, RadioCallback, EkfCallback, VibrationCallback,
  ServoOutputCallback, WindCallback, TerrainCallback, ScaledImuCallback,
  ScaledPressureCallback, HomePositionCallback, GpsOriginCallback, PowerStatusCallback,
  DistanceSensorCallback, FenceStatusCallback, EstimatorStatusCallback,
  CameraTriggerCallback, NavControllerCallback, LocalPositionCallback,
  DebugCallback, GimbalAttitudeCallback, ObstacleDistanceCallback,
  CameraImageCapturedCallback, ExtendedSysStateCallback, FencePointCallback,
  SystemTimeCallback, AutopilotVersionCallback, CanFrameCallback,
} from "@/lib/protocol/types";
import { ArduCopterHandler, ArduPlaneHandler, ArduRoverHandler, ArduSubHandler } from "@/lib/protocol/firmware/ardupilot";
import { PX4Handler } from "@/lib/protocol/firmware/px4";
import { betaflightHandler } from "@/lib/protocol/firmware/betaflight";
import { inavHandler } from "@/lib/protocol/firmware/inav";
import { ParamAbsentError } from "@/lib/protocol/mavlink-adapter-params";
import { decodeBoardId } from "@/lib/protocol/handlers/info-handlers";
import { MOCK_PARAMS, ARDUPLANE_MOCK_PARAMS, HELI_MOCK_PARAMS, QUADPLANE_MOCK_PARAMS, TAILSITTER_MOCK_PARAMS, TILTROTOR_MOCK_PARAMS, ROVER_MOCK_PARAMS, BOAT_MOCK_PARAMS, type MockParam } from "./mock-params";
import { PX4_MOCK_PARAMS } from "./mock-params-px4";
import { BETAFLIGHT_MOCK_PARAMS } from "./mock-params-betaflight";
import { createCallbackArrays, bindOnMethods } from "./mock-protocol-callbacks";
import type { ManualControlSample } from "./mock-control-samples";
import { setMockEkfSourceSet } from "./mock-ekf-source";
import * as E from "./mock-protocol-emitters";
import { mockStartCalibration, type CalibrationContext, type CalTimer } from "./mock-protocol-calibration";
import { MockFlightState } from "./mock-protocol-flight";
import { handleSerialCommand, startTelemetryTick, type TelemetryTickContext } from "./mock-protocol-serial";
import { MOCK_VEHICLE_INFO, HELI_VEHICLE_INFO, PX4_VEHICLE_INFO, PX4_VTOL_VEHICLE_INFO, ARDUPLANE_VEHICLE_INFO, ARDUPLANE_VTOL_VEHICLE_INFO, ARDUPLANE_TAILSITTER_VEHICLE_INFO, ARDUPLANE_TILTROTOR_VEHICLE_INFO, ARDUROVER_VEHICLE_INFO, ARDUBOAT_VEHICLE_INFO, ARDUSUB_VEHICLE_INFO, BETAFLIGHT_VEHICLE_INFO, INAV_FW_VEHICLE_INFO } from "./mock-protocol-data";
import type { DisplayPortOp } from "@/lib/protocol/msp/decoders/config/displayport";
import { startMockDisplayPort } from "./mock-protocol-bf-storage";
import { MockMission } from "./mock-protocol-mission";
import { MockProtocolPeripherals } from "./mock-protocol-peripherals";
import { px4MissionRejection } from "./mock-px4-mission-rules";
import { MockFcFiles } from "./mock-protocol-files";
import { createMockFrameFeed } from "./mock-mavlink-frames";
import type { LinkInfo } from "@/lib/protocol/types";

export { MOCK_FENCE_POLYGON } from "./mock-protocol-data";

import type { MockFirmware } from "./mock-firmware";

function ok(message = "OK"): CommandResult { return { success: true, resultCode: 0, message }; }

/** The demo FC; its peripherals and stored plans live in MockProtocolPeripherals. */
export class MockProtocol extends MockProtocolPeripherals implements DroneProtocol {
  readonly protocolName = "mock-mavlink";
  private _connected = true;
  private handler: FirmwareHandler;
  private _vehicleInfo: VehicleInfo;
  private params: Map<string, MockParam>;
  private defaults: MockParam[];
  private cbs = createCallbackArrays();
  private _on = bindOnMethods(this.cbs);
  private calTimers: CalTimer[] = [];
  private tickTimers: ReturnType<typeof setInterval>[] = [];
  private imageCounter = { value: 0 };
  private _rcChannelValues: number[] = Array(16).fill(1500);
  private _lastManualControl: ManualControlSample | null = null;
  /** Arm / airborne / mode of this demo vehicle; see mock-protocol-flight. */
  readonly flight = new MockFlightState(
    (s) => this.emitHeartbeat(s.armed, s.mode),
    (severity, text) => this.emitStatusText(severity, text),
  );

  constructor(firmwareType: MockFirmware = 'ardupilot-copter') {
    super();
    switch (firmwareType) {
      case 'px4':
        this.handler = new PX4Handler(); this.defaults = PX4_MOCK_PARAMS; this._vehicleInfo = PX4_VEHICLE_INFO; break;
      case 'px4-vtol':
        this.handler = new PX4Handler('vtol'); this.defaults = PX4_MOCK_PARAMS; this._vehicleInfo = PX4_VTOL_VEHICLE_INFO; break;
      case 'ardupilot-heli':
        this.handler = new ArduCopterHandler(); this.defaults = HELI_MOCK_PARAMS; this._vehicleInfo = HELI_VEHICLE_INFO; break;
      case 'ardupilot-plane':
        this.handler = new ArduPlaneHandler(); this.defaults = ARDUPLANE_MOCK_PARAMS; this._vehicleInfo = ARDUPLANE_VEHICLE_INFO; break;
      case 'ardupilot-plane-vtol':
        this.handler = new ArduPlaneHandler(); this.defaults = QUADPLANE_MOCK_PARAMS; this._vehicleInfo = ARDUPLANE_VTOL_VEHICLE_INFO; break;
      case 'ardupilot-plane-tailsitter':
        this.handler = new ArduPlaneHandler(); this.defaults = TAILSITTER_MOCK_PARAMS; this._vehicleInfo = ARDUPLANE_TAILSITTER_VEHICLE_INFO; break;
      case 'ardupilot-plane-tiltrotor':
        this.handler = new ArduPlaneHandler(); this.defaults = TILTROTOR_MOCK_PARAMS; this._vehicleInfo = ARDUPLANE_TILTROTOR_VEHICLE_INFO; break;
      case 'ardupilot-rover':
        this.handler = new ArduRoverHandler(); this.defaults = ROVER_MOCK_PARAMS; this._vehicleInfo = ARDUROVER_VEHICLE_INFO; break;
      case 'ardupilot-boat':
        this.handler = new ArduRoverHandler(); this.defaults = BOAT_MOCK_PARAMS; this._vehicleInfo = ARDUBOAT_VEHICLE_INFO; break;
      case 'ardupilot-sub':
        this.handler = new ArduSubHandler(); this.defaults = MOCK_PARAMS; this._vehicleInfo = ARDUSUB_VEHICLE_INFO; break;
      case 'betaflight':
        this.handler = betaflightHandler; this.defaults = BETAFLIGHT_MOCK_PARAMS; this._vehicleInfo = BETAFLIGHT_VEHICLE_INFO; break;
      case 'inav-plane':
        // iNav is a name-based MSP settings surface, not a MAVLink parameter set,
        // so there are no mock MAVLink params to seed; the iNav nav items surface
        // from inavHandler's capabilities + the plane vehicle class.
        this.handler = inavHandler; this.defaults = []; this._vehicleInfo = INAV_FW_VEHICLE_INFO; break;
      default:
        this.handler = new ArduCopterHandler(); this.defaults = MOCK_PARAMS; this._vehicleInfo = MOCK_VEHICLE_INFO; break;
    }
    this.params = new Map();
    for (const p of this.defaults) this.params.set(p.name, { ...p });
  }

  // ── Emit methods (called by engine) ────────────────────
  emitStatusText(severity: number, text: string): void { E.emitStatusText(this.cbs, severity, text); }
  /** Emit a synthetic PX4 EVENT (msg 410) to the onEvent subscribers (demo). */
  emitEvent(frame: { id: number; logLevels: number; arguments: Uint8Array; eventTimeBootMs: number }): void {
    for (const cb of this.cbs.eventCbs) {
      cb({
        id: frame.id,
        eventTimeBootMs: frame.eventTimeBootMs,
        sequence: 0,
        destinationComponent: 1,
        destinationSystem: 1,
        logLevels: frame.logLevels,
        arguments: frame.arguments,
      });
    }
  }
  emitHeartbeat(armed: boolean, mode: UnifiedFlightMode): void { E.emitHeartbeat(this.cbs, armed, mode, this._vehicleInfo); }
  emitSysStatus(d: Parameters<SysStatusCallback>[0]): void { E.emitSysStatus(this.cbs, d); }
  emitRadio(d: Parameters<RadioCallback>[0]): void { E.emitRadio(this.cbs, d); }
  emitEkf(d: Parameters<EkfCallback>[0]): void { E.emitEkf(this.cbs, d); }
  emitVibration(d: Parameters<VibrationCallback>[0]): void { E.emitVibration(this.cbs, d); }
  emitServoOutput(d: Parameters<ServoOutputCallback>[0]): void { E.emitServoOutput(this.cbs, d); }
  emitWind(d: Parameters<WindCallback>[0]): void { E.emitWind(this.cbs, d); }
  emitTerrain(d: Parameters<TerrainCallback>[0]): void { E.emitTerrain(this.cbs, d); }
  emitScaledImu(d: Parameters<ScaledImuCallback>[0]): void { E.emitScaledImu(this.cbs, d); }
  emitScaledPressure(d: Parameters<ScaledPressureCallback>[0]): void { E.emitScaledPressure(this.cbs, d); }
  emitHomePosition(d: Parameters<HomePositionCallback>[0]): void { E.emitHomePosition(this.cbs, d); }
  emitGpsOrigin(d: Parameters<GpsOriginCallback>[0]): void { E.emitGpsOrigin(this.cbs, d); }
  emitPowerStatus(d: Parameters<PowerStatusCallback>[0]): void { E.emitPowerStatus(this.cbs, d); }
  emitDistanceSensor(d: Parameters<DistanceSensorCallback>[0]): void { E.emitDistanceSensor(this.cbs, d); }
  emitFenceStatus(d: Parameters<FenceStatusCallback>[0]): void { E.emitFenceStatus(this.cbs, d); }
  emitEstimatorStatus(d: Parameters<EstimatorStatusCallback>[0]): void { E.emitEstimatorStatus(this.cbs, d); }
  emitCameraTrigger(d: Parameters<CameraTriggerCallback>[0]): void { E.emitCameraTrigger(this.cbs, d); }
  emitNavController(d: Parameters<NavControllerCallback>[0]): void { E.emitNavController(this.cbs, d); }
  emitLocalPosition(d: Parameters<LocalPositionCallback>[0]): void { E.emitLocalPosition(this.cbs, d); }
  emitDebug(d: Parameters<DebugCallback>[0]): void { E.emitDebug(this.cbs, d); }
  emitGimbalAttitude(d: Parameters<GimbalAttitudeCallback>[0]): void { E.emitGimbalAttitude(this.cbs, d); }
  emitObstacleDistance(d: Parameters<ObstacleDistanceCallback>[0]): void { E.emitObstacleDistance(this.cbs, d); }
  emitCameraImageCaptured(d: Parameters<CameraImageCapturedCallback>[0]): void { E.emitCameraImageCaptured(this.cbs, d); }
  emitExtendedSysState(d: Parameters<ExtendedSysStateCallback>[0]): void { E.emitExtendedSysState(this.cbs, d); }
  emitFencePoint(d: Parameters<FencePointCallback>[0]): void { E.emitFencePoint(this.cbs, d); }
  emitSystemTime(d: Parameters<SystemTimeCallback>[0]): void { E.emitSystemTime(this.cbs, d); }
  emitAutopilotVersion(d: Parameters<AutopilotVersionCallback>[0]): void { E.emitAutopilotVersion(this.cbs, d); }
  emitCanFrame(d: Parameters<CanFrameCallback>[0]): void { E.emitCanFrame(this.cbs, d); }
  /** MISSION_CURRENT: the mission item the vehicle is flying toward. */
  emitMissionCurrent(seq: number): void { for (const cb of this.cbs.missionProgressCbs) cb({ currentSeq: seq }); }

  // ── Connection ─────────────────────────────────────────
  get isConnected(): boolean { return this._connected; }
  async connect(_t: Transport): Promise<VehicleInfo> { this._connected = true; return this._vehicleInfo; }
  async disconnect(): Promise<void> {
    const was = this._connected;
    this.stopMockTelemetryTick(); this.clearCalTimers(); this._connected = false;
    if (was) for (const cb of [...this.disconnectCbs]) cb();
  }
  private disconnectCbs: Array<() => void> = [];
  onDisconnect(cb: () => void): () => void { this.disconnectCbs.push(cb); return () => { this.disconnectCbs = this.disconnectCbs.filter((c) => c !== cb); }; }
  private readonly connectedAt = Date.now();
  /** One primary demo link. */
  get linkInfo(): LinkInfo[] {
    return [{ id: "demo-link", type: "websocket", label: "Demo link", isConnected: this._connected, connectedAt: this.connectedAt, lastByteAt: Date.now(), isPrimary: true }];
  }
  /** Demo MAVLink frames for the Inspector, real wire layouts. */
  onMavlinkFrame = createMockFrameFeed(() => this._vehicleInfo);

  // ── Commands ───────────────────────────────────────────
  async arm(): Promise<CommandResult> { return this.flight.arm(); }
  async disarm(): Promise<CommandResult> { return this.flight.disarm(); }
  async setFlightMode(m: UnifiedFlightMode): Promise<CommandResult> { return this.flight.setMode(m); }
  async returnToLaunch(): Promise<CommandResult> { this.emitStatusText(6, "Returning to launch"); this.flight.setMode("RTL"); return ok("RTL"); }
  async land(): Promise<CommandResult> { return this.flight.land(); }
  async takeoff(alt: number): Promise<CommandResult> { return this.flight.takeoff(alt); }
  async killSwitch(confirmed: boolean): Promise<CommandResult> {
    // Demo mode mirrors the real refusal so a caller that skips the confirm
    // fails the same way here as it does against a vehicle.
    if (!confirmed) return { success: false, resultCode: -1, message: "Flight termination requires explicit confirmation" };
    this.emitStatusText(2, "KILL SWITCH ACTIVATED");
    this.flight.kill();
    return ok("Kill switch");
  }
  async guidedGoto(lat: number, lon: number, alt: number): Promise<CommandResult> { return ok(`Goto ${lat.toFixed(6)}, ${lon.toFixed(6)} @ ${alt}m`); }
  async pauseMission(): Promise<CommandResult> { return ok("Mission paused"); }
  async resumeMission(): Promise<CommandResult> { return ok("Mission resumed"); }
  async clearMission(): Promise<CommandResult> { this.mission.clear(); return ok("Mission cleared"); }
  async commitParamsToFlash(): Promise<CommandResult> { return ok("Params saved to flash"); }
  async setHome(): Promise<CommandResult> { return ok("Home set"); }
  async changeSpeed(): Promise<CommandResult> { return ok("Speed changed"); }
  async setYaw(): Promise<CommandResult> { return ok("Yaw set"); }
  async setGeoFenceEnabled(): Promise<CommandResult> { return ok("Geofence updated"); }
  async setServo(): Promise<CommandResult> { return ok("Servo set"); }
  async cameraTrigger(): Promise<CommandResult> { return ok("Camera triggered"); }
  async setGimbalAngle(): Promise<CommandResult> { return ok("Gimbal set"); }
  async setGimbalMode(): Promise<CommandResult> { return ok("Gimbal mode set"); }
  async setGimbalROI(): Promise<CommandResult> { return ok("Gimbal ROI set"); }
  async setRoiLocation(): Promise<CommandResult> { return ok("ROI location set"); }
  async clearRoi(): Promise<CommandResult> { return ok("ROI cleared"); }
  async orbit(): Promise<CommandResult> { return ok("Orbit started"); }
  async setEkfOrigin(): Promise<CommandResult> { return ok("EKF origin set"); }
  async setEkfSourceSet(sourceSet: 1 | 2 | 3): Promise<{ ok: true } | { ok: false; reason: "px4-not-supported" | "no-ack" | "rejected" }> {
    if (sourceSet !== 1 && sourceSet !== 2 && sourceSet !== 3) {
      throw new TypeError(`setEkfSourceSet: sourceSet must be 1, 2, or 3 (received ${String(sourceSet)})`);
    }
    await new Promise((r) => setTimeout(r, 200));
    setMockEkfSourceSet(sourceSet);
    return { ok: true };
  }
  async enableFence(): Promise<CommandResult> { return ok("Fence updated"); }
  async doLandStart(): Promise<CommandResult> { return ok("Land start"); }
  async controlVideo(): Promise<CommandResult> { return ok("Video control"); }
  async setRelay(): Promise<CommandResult> { return ok("Relay set"); }
  async startRxPair(): Promise<CommandResult> { return ok("RX pair started"); }
  async setMessageInterval(): Promise<CommandResult> { return ok("Interval set"); }
  sendManualControl(roll: number, pitch: number, throttle: number, yaw: number, buttons: number): void {
    this._lastManualControl = { roll, pitch, throttle, yaw, buttons };
  }
  setRcChannelValues(channels: number[]): void { this._rcChannelValues = channels; }

  /** Last stick frame handed to this mock, or null if none. */
  getLastManualControl(): ManualControlSample | null { return this._lastManualControl; }

  /**
   * MAV_CMD_RUN_PREARM_CHECKS semantics: the command is accepted, failures are
   * reported as STATUSTEXT, and a pass is carried by the SYS_STATUS pre-arm bit
   * the demo engine publishes. Nothing is sent when every check passes.
   */
  async doPreArmCheck(): Promise<CommandResult> {
    const names = ["Roll", "Pitch", "Throttle", "Yaw"];
    for (let ch = 1; ch <= 4; ch++) {
      const trim = this.params.get(`RC${ch}_TRIM`)?.value ?? 1500;
      const dz = this.params.get(`RC${ch}_DZ`)?.value ?? 30;
      if (Math.abs((this._rcChannelValues[ch - 1] ?? 1500) - trim) > dz) {
        setTimeout(() => this.emitStatusText(4, `Arm: ${names[ch - 1]} (RC${ch}) is not neutral`), 100 * ch);
      }
    }
    return ok("Pre-arm check");
  }

  // ── Parameters ─────────────────────────────────────────
  getCachedParameterNames(): string[] { return Array.from(this.params.keys()); }
  async getAllParameters(): Promise<ParameterValue[]> {
    const all = Array.from(this.params.values()), count = all.length;
    for (let i = 0; i < all.length; i++) { const p = all[i]; for (const cb of this.cbs.parameterCbs) cb({ name: p.name, value: p.value, type: p.type, index: i, count }); }
    return all.map((p, i) => ({ name: p.name, value: p.value, type: p.type, index: i, count }));
  }
  // The real adapter resolves a canonical name to the firmware's own (PX4
  // FENCE_ENABLE is GF_ACTION) and reports the value under the canonical name.
  // The mock holds each firmware's own names, so it resolves the same way.
  async getParameter(name: string): Promise<ParameterValue> {
    const fwName = this.handler.mapParameterName(name);
    const p = this.params.get(fwName);
    // Hardware rejects an absent parameter with ParamAbsentError and
    // `usePanelParams` branches on `err.code === "param_absent"` to render
    // "not present on this board". Returning `value: 0` here made every one of
    // the 87 panels show a hard 0 in demo for any parameter missing from
    // `mock-params.ts`, indistinguishable from a real FC reading, and left the
    // whole absent-parameter UI branch unreachable in demo mode.
    if (!p) throw new ParamAbsentError(name);
    return { name, value: p.value, type: p.type, index: Array.from(this.params.keys()).indexOf(fwName), count: this.params.size };
  }
  async setParameter(name: string, value: number): Promise<CommandResult> {
    const fwName = this.handler.mapParameterName(name);
    const existing = this.params.get(fwName);
    if (existing) existing.value = value; else this.params.set(fwName, { name: fwName, value, type: 9 });
    const pv: ParameterValue = { name, value, type: existing?.type ?? 9, index: Array.from(this.params.keys()).indexOf(fwName), count: this.params.size };
    for (const cb of this.cbs.parameterCbs) cb(pv);
    return ok(`${name} = ${value}`);
  }
  async resetParametersToDefault(): Promise<CommandResult> {
    this.params.clear(); for (const p of this.defaults) this.params.set(p.name, { ...p });
    this.emitStatusText(5, "Parameters reset to defaults"); return ok("Parameters reset");
  }

  // ── Mission ────────────────────────────────────────────
  private mission = new MockMission(() => this._vehicleInfo.firmwareType.startsWith("ardupilot-"));
  /** Seed the mission this vehicle holds without a transfer (the demo route it flies). */
  loadMission(items: readonly MissionItem[]): void { this.mission.load(items); }
  async uploadMission(items: MissionItem[], onProgress?: MissionUploadProgressCallback): Promise<CommandResult> {
    // A PX4 vehicle refuses the first item it cannot parse and keeps its old mission.
    if (this._vehicleInfo.firmwareType === "px4") {
      const refused = px4MissionRejection(items, this._vehicleInfo.vehicleClass);
      if (refused) {
        for (let sent = 1; sent <= refused.seq + 1; sent++) onProgress?.(sent, items.length);
        return { success: false, resultCode: refused.result, message: `Mission rejected: item ${refused.seq}, MAV_MISSION_RESULT ${refused.result}` };
      }
    }
    for (let sent = 1; sent <= items.length; sent++) onProgress?.(sent, items.length);
    return this.mission.upload(items);
  }
  async downloadMission(): Promise<MissionItem[]> { return this.mission.download(); }
  async setCurrentMissionItem(): Promise<CommandResult> { return ok("Mission item set"); }

  // ── Calibration (delegated) ────────────────────────────
  async startCalibration(type: "accel" | "gyro" | "compass" | "level" | "airspeed" | "baro" | "rc" | "esc" | "compassmot"): Promise<CommandResult> {
    const ctx: CalibrationContext = {
      vehicleFirmwareType: this._vehicleInfo.firmwareType, isPX4: this._vehicleInfo.firmwareType === "px4",
      calTimers: this.calTimers,
      magCalProgressCbs: this.cbs.magCalProgressCbs, magCalReportCbs: this.cbs.magCalReportCbs, accelCalPosCbs: this.cbs.accelCalPosCbs,
      emitStatusText: (s, t) => this.emitStatusText(s, t), emitAccelCalPos: (p) => E.emitAccelCalPos(this.cbs, p),
      clearCalTimers: () => this.clearCalTimers(),
    };
    return mockStartCalibration(ctx, type);
  }
  confirmAccelCalPos(position: number): void {
    const t = setTimeout(() => {
      if (position + 1 <= 6) E.emitAccelCalPos(this.cbs, (position + 1) as AccelCalPosition);
      else { this.emitStatusText(5, "Calibration successful"); this.calTimers.push(setTimeout(() => this.emitStatusText(5, "PreArm: Accels calibrated requires reboot"), 200)); }
    }, 800);
    this.calTimers.push(t);
  }
  async acceptCompassCal(): Promise<CommandResult> { return ok("Compass calibration accepted"); }
  async cancelCompassCal(): Promise<CommandResult> { this.clearCalTimers(); return ok("Compass calibration cancelled"); }
  async cancelCalibration(): Promise<CommandResult> { this.clearCalTimers(); return ok("Calibration cancelled"); }
  async startGnssMagCal(yawDeg: number): Promise<CommandResult> {
    this.emitStatusText(6, "[cal] calibration started: 2");
    this.calTimers.push(setTimeout(() => { this.emitStatusText(6, "[cal] progress <50>"); this.calTimers.push(setTimeout(() => this.emitStatusText(6, "[cal] calibration done: mag"), 1000)); }, 500));
    return ok(`Compass calibration for yaw ${yawDeg}° started`);
  }
  /** clearTimeout also cancels interval handles (shared timer id space). */
  private clearCalTimers(): void { for (const t of this.calTimers) clearTimeout(t as ReturnType<typeof setTimeout>); this.calTimers.length = 0; }

  // ── Log Download / FTP (delegated) ─────────────────────
  private files = new MockFcFiles();
  getLogList(): Promise<LogEntry[]> { return this.files.getLogList(); }
  downloadLog(id: number, onProgress?: LogDownloadProgressCallback): Promise<Uint8Array> { return this.files.downloadLog(id, onProgress); }
  async eraseAllLogs(): Promise<CommandResult> { this.emitStatusText(6, "All logs erased"); return ok("Logs erased"); }
  cancelLogDownload(): void {}
  downloadFileViaFtp(path: string, onProgress?: FtpDownloadProgressCallback): Promise<Uint8Array> { return this.files.downloadFileViaFtp(path, onProgress); }
  uploadFileViaFtp(...a: Parameters<MockFcFiles["uploadFileViaFtp"]>): Promise<void> { return this.files.uploadFileViaFtp(...a); }
  listDirectoryViaFtp(path: string) { return this.files.listDirectoryViaFtp(path); }
  removeFileViaFtp(path: string): Promise<void> { return this.files.removeFileViaFtp(path); }

  /** Demo mode never has a real FC-served metadata overlay. */
  getComponentMetadataUri(): string | null { return null; }

  // ── DisplayPort OSD push (mock) ────────────────────────
  onDisplayPort(cb: (op: DisplayPortOp) => void): () => void {
    const id = startMockDisplayPort(cb);
    this.tickTimers.push(id);
    return () => { clearInterval(id); this.tickTimers = this.tickTimers.filter((t) => t !== id); };
  }

  // ── Motor Test / Reboot ────────────────────────────────
  async motorTest(motor: number, throttle: number, duration: number): Promise<CommandResult> { this.emitStatusText(6, `Motor ${motor} test: ${throttle}% for ${duration}s`); return ok(`Motor ${motor} tested`); }
  async actuatorTest(functionCode: number, value: number, timeoutS: number): Promise<CommandResult> { this.emitStatusText(6, `Actuator ${functionCode} test: ${Number.isNaN(value) ? "stop" : value} for ${timeoutS}s`); return ok("Actuator test sent"); }
  async rebootToBootloader(): Promise<CommandResult> { return ok("Reboot to bootloader (mock)"); }
  async reboot(): Promise<CommandResult> { this.emitStatusText(5, "Rebooting..."); return ok("Reboot (mock)"); }

  // ── Serial / Telemetry Tick (delegated) ────────────────
  sendSerialData(text: string): void { handleSerialCommand({ serialDataCbs: this.cbs.serialDataCbs }, text.trim()); }
  startMockTelemetryTick(): void {
    this.stopMockTelemetryTick();
    const ctx: TelemetryTickContext = { emitDebug: (d) => this.emitDebug(d), emitGimbalAttitude: (d) => this.emitGimbalAttitude(d), emitObstacleDistance: (d) => this.emitObstacleDistance(d), emitLocalPosition: (d) => this.emitLocalPosition(d), emitCameraImageCaptured: (d) => this.emitCameraImageCaptured(d) };
    startTelemetryTick(ctx, this.tickTimers, this.imageCounter);
  }
  stopMockTelemetryTick(): void { for (const t of this.tickTimers) clearInterval(t); this.tickTimers = []; }
  async requestMessage(messageId: number): Promise<CommandResult> {
    if (messageId === 148) {
      // SpeedyBee F405 Wing: ArduPilot sends its board id in the upper 16 bits of
      // board_version. The id is decoded and stored exactly as the adapter does.
      const boardVersion = (1106 << 16) >>> 0;
      const boardId = decodeBoardId(boardVersion, this._vehicleInfo.firmwareType);
      setTimeout(() => {
        this._vehicleInfo = { ...this._vehicleInfo, boardId };
        this.emitAutopilotVersion({ capabilities: 0xFF, flightSwVersion: 0x04050007, middlewareSwVersion: 0, osSwVersion: 0, boardVersion, boardId, uid: 0 });
      }, 0);
    }
    return ok("Message requested");
  }

  // ── Telemetry Subscriptions (delegated) ────────────────
  onAttitude = this._on.onAttitude; onPosition = this._on.onPosition;
  onBattery = this._on.onBattery; onGps = this._on.onGps;
  onVfr = this._on.onVfr; onRc = this._on.onRc;
  onStatusText = this._on.onStatusText; onEvent = this._on.onEvent; onHeartbeat = this._on.onHeartbeat;
  onParameter = this._on.onParameter; onSerialData = this._on.onSerialData;
  onSysStatus = this._on.onSysStatus; onRadio = this._on.onRadio;
  onMissionProgress = this._on.onMissionProgress; onEkf = this._on.onEkf;
  onVibration = this._on.onVibration; onServoOutput = this._on.onServoOutput;
  onWind = this._on.onWind; onTerrain = this._on.onTerrain;
  onMagCalProgress = this._on.onMagCalProgress; onMagCalReport = this._on.onMagCalReport;
  onAccelCalPos = this._on.onAccelCalPos; onHomePosition = this._on.onHomePosition; onGpsOrigin = this._on.onGpsOrigin;
  onAutopilotVersion = this._on.onAutopilotVersion; onPowerStatus = this._on.onPowerStatus;
  onDistanceSensor = this._on.onDistanceSensor; onFenceStatus = this._on.onFenceStatus;
  onNavController = this._on.onNavController; onScaledImu = this._on.onScaledImu;
  onScaledPressure = this._on.onScaledPressure; onEstimatorStatus = this._on.onEstimatorStatus;
  onCameraTrigger = this._on.onCameraTrigger; onLinkLost = this._on.onLinkLost;
  onLinkRestored = this._on.onLinkRestored; onLocalPosition = this._on.onLocalPosition;
  onDebug = this._on.onDebug; onGimbalAttitude = this._on.onGimbalAttitude;
  onObstacleDistance = this._on.onObstacleDistance; onCameraImageCaptured = this._on.onCameraImageCaptured;
  onAdsbVehicle = this._on.onAdsbVehicle;
  onExtendedSysState = this._on.onExtendedSysState; onFencePoint = this._on.onFencePoint;
  onSystemTime = this._on.onSystemTime; onRawImu = this._on.onRawImu;
  onRcChannelsRaw = this._on.onRcChannelsRaw; onRcChannelsOverride = this._on.onRcChannelsOverride;
  onMissionItem = this._on.onMissionItem; onAltitude = this._on.onAltitude;
  onWindCov = this._on.onWindCov; onAisVessel = this._on.onAisVessel;
  onGimbalManagerInfo = this._on.onGimbalManagerInfo; onGimbalManagerStatus = this._on.onGimbalManagerStatus;
  onCanFrame = this._on.onCanFrame;
  onCanFdFrame: NonNullable<DroneProtocol["onCanFdFrame"]> = (_cb) => () => {};
  enableCanForward: NonNullable<DroneProtocol["enableCanForward"]> = async () => ok("CAN forwarding enabled (mock)");
  sendCanFrame: NonNullable<DroneProtocol["sendCanFrame"]> = () => {};
  sendCanFdFrame: NonNullable<DroneProtocol["sendCanFdFrame"]> = () => {};
  onOpticalFlow = this._on.onOpticalFlow; onOpticalFlowRad = this._on.onOpticalFlowRad;
  onOdometry = this._on.onOdometry;
  onVisionPositionEstimate = this._on.onVisionPositionEstimate;
  onVisionPositionDelta = this._on.onVisionPositionDelta;

  // ── Info ───────────────────────────────────────────────
  getVehicleInfo(): VehicleInfo { return this._vehicleInfo; }
  getCapabilities(): ProtocolCapabilities { return this.handler.getCapabilities(); }
  getCommandQueueSnapshot(): CommandQueueSnapshot { return { pendingCount: 0, entries: [] }; }
  setDiagnosticsEnabled(_enabled: boolean): void {}
  getFirmwareHandler(): FirmwareHandler { return this.handler; }
}
