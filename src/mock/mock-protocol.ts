/**
 * MockProtocol — Full DroneProtocol implementation for demo mode.
 *
 * @license GPL-3.0-only
 */

import type {
  DroneProtocol, Transport, VehicleInfo, CommandResult, ParameterValue,
  ProtocolCapabilities, FirmwareHandler, MissionItem, UnifiedFlightMode,
  LogEntry, LogDownloadProgressCallback, FtpDownloadProgressCallback, FtpDirEntry, AccelCalPosition,
  SysStatusCallback, RadioCallback, EkfCallback, VibrationCallback,
  ServoOutputCallback, WindCallback, TerrainCallback, ScaledImuCallback,
  ScaledPressureCallback, HomePositionCallback, PowerStatusCallback,
  DistanceSensorCallback, FenceStatusCallback, EstimatorStatusCallback,
  CameraTriggerCallback, NavControllerCallback, LocalPositionCallback,
  DebugCallback, GimbalAttitudeCallback, ObstacleDistanceCallback,
  CameraImageCapturedCallback, ExtendedSysStateCallback, FencePointCallback,
  SystemTimeCallback, AutopilotVersionCallback,
  CanFrameCallback, FenceElement,
} from "@/lib/protocol/types";
import { ArduCopterHandler, ArduPlaneHandler, ArduRoverHandler, ArduSubHandler } from "@/lib/protocol/firmware/ardupilot";
import { PX4Handler } from "@/lib/protocol/firmware/px4";
import { betaflightHandler } from "@/lib/protocol/firmware/betaflight";
import { inavHandler } from "@/lib/protocol/firmware/inav";
import { MOCK_PARAMS, HELI_MOCK_PARAMS, PX4_MOCK_PARAMS, BETAFLIGHT_MOCK_PARAMS, QUADPLANE_MOCK_PARAMS, TAILSITTER_MOCK_PARAMS, TILTROTOR_MOCK_PARAMS, ROVER_MOCK_PARAMS, BOAT_MOCK_PARAMS, type MockParam } from "./mock-params";
import { createCallbackArrays, bindOnMethods } from "./mock-protocol-callbacks";
import type { ManualControlSample, PositionTargetSample, AttitudeTargetSample } from "./mock-control-samples";
import * as E from "./mock-protocol-emitters";
import { mockStartCalibration, type CalibrationContext } from "./mock-protocol-calibration";
import { handleSerialCommand, startTelemetryTick, type TelemetryTickContext } from "./mock-protocol-serial";
import { MOCK_FENCE_POLYGON, MOCK_VEHICLE_INFO, HELI_VEHICLE_INFO, PX4_VEHICLE_INFO, PX4_VTOL_VEHICLE_INFO, ARDUPLANE_VEHICLE_INFO, ARDUPLANE_VTOL_VEHICLE_INFO, ARDUPLANE_TAILSITTER_VEHICLE_INFO, ARDUPLANE_TILTROTOR_VEHICLE_INFO, ARDUROVER_VEHICLE_INFO, ARDUBOAT_VEHICLE_INFO, ARDUSUB_VEHICLE_INFO, BETAFLIGHT_VEHICLE_INFO, INAV_FW_VEHICLE_INFO, getMockMission, getMockLogList } from "./mock-protocol-data";
import type { DisplayPortOp } from "@/lib/protocol/msp/decoders/config/displayport";

export { MOCK_FENCE_POLYGON } from "./mock-protocol-data";

/** Firmware + vehicle-class variants the demo fleet can instantiate. */
export type MockFirmware =
  | "ardupilot-copter"
  | "ardupilot-heli"
  | "ardupilot-plane"
  | "ardupilot-plane-vtol"
  | "ardupilot-plane-tailsitter"
  | "ardupilot-plane-tiltrotor"
  | "ardupilot-rover"
  | "ardupilot-boat"
  | "ardupilot-sub"
  | "px4"
  | "px4-vtol"
  | "betaflight"
  | "inav-plane";

function ok(message = "OK"): CommandResult { return { success: true, resultCode: 0, message }; }

export class MockProtocol implements DroneProtocol {
  readonly protocolName = "mock-mavlink";
  private _connected = true;
  private handler: FirmwareHandler;
  private _vehicleInfo: VehicleInfo;
  private params: Map<string, MockParam>;
  private defaults: MockParam[];
  private cbs = createCallbackArrays();
  private _on = bindOnMethods(this.cbs);
  private accelCalTimers: ReturnType<typeof setTimeout>[] = [];
  private compassCalTimers: ReturnType<typeof setTimeout | typeof setInterval>[] = [];
  private tickTimers: ReturnType<typeof setInterval>[] = [];
  private imageCounter = { value: 0 };
  private _rcChannelValues: number[] = Array(16).fill(1500);
  private _lastManualControl: ManualControlSample | null = null;
  private _lastPositionTarget: PositionTargetSample | null = null;
  private _lastAttitudeTarget: AttitudeTargetSample | null = null;
  private rallyPoints: Array<{ lat: number; lon: number; alt: number }> = [];
  private fenceElements: FenceElement[] = [];

  constructor(firmwareType: MockFirmware = 'ardupilot-copter') {
    switch (firmwareType) {
      case 'px4':
        this.handler = new PX4Handler(); this.defaults = PX4_MOCK_PARAMS; this._vehicleInfo = PX4_VEHICLE_INFO; break;
      case 'px4-vtol':
        this.handler = new PX4Handler('vtol'); this.defaults = PX4_MOCK_PARAMS; this._vehicleInfo = PX4_VTOL_VEHICLE_INFO; break;
      case 'ardupilot-heli':
        this.handler = new ArduCopterHandler(); this.defaults = HELI_MOCK_PARAMS; this._vehicleInfo = HELI_VEHICLE_INFO; break;
      case 'ardupilot-plane':
        this.handler = new ArduPlaneHandler(); this.defaults = MOCK_PARAMS; this._vehicleInfo = ARDUPLANE_VEHICLE_INFO; break;
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

  // ── Connection ─────────────────────────────────────────
  get isConnected(): boolean { return this._connected; }
  async connect(_t: Transport): Promise<VehicleInfo> { this._connected = true; return this._vehicleInfo; }
  async disconnect(): Promise<void> { this.stopMockTelemetryTick(); this.clearAccelTimers(); this.clearCompassTimers(); this._connected = false; }

  // ── Commands ───────────────────────────────────────────
  async arm(): Promise<CommandResult> { this.emitStatusText(6, "Arming motors"); return ok("Armed"); }
  async disarm(): Promise<CommandResult> { this.emitStatusText(6, "Disarming motors"); return ok("Disarmed"); }
  async setFlightMode(m: UnifiedFlightMode): Promise<CommandResult> { this.emitStatusText(6, `Mode change to ${m}`); return ok(`Mode: ${m}`); }
  async returnToLaunch(): Promise<CommandResult> { this.emitStatusText(6, "Returning to launch"); return ok("RTL"); }
  async land(): Promise<CommandResult> { this.emitStatusText(6, "Landing"); return ok("Landing"); }
  async takeoff(alt: number): Promise<CommandResult> { this.emitStatusText(6, `Taking off to ${alt}m`); return ok(`Takeoff ${alt}m`); }
  async killSwitch(confirmed: boolean): Promise<CommandResult> {
    // Demo mode mirrors the real refusal so a caller that skips the confirm
    // fails the same way here as it does against a vehicle.
    if (!confirmed) return { success: false, resultCode: -1, message: "Flight termination requires explicit confirmation" };
    this.emitStatusText(2, "KILL SWITCH ACTIVATED");
    return ok("Kill switch");
  }
  async guidedGoto(lat: number, lon: number, alt: number): Promise<CommandResult> { return ok(`Goto ${lat.toFixed(6)}, ${lon.toFixed(6)} @ ${alt}m`); }
  async pauseMission(): Promise<CommandResult> { return ok("Mission paused"); }
  async resumeMission(): Promise<CommandResult> { return ok("Mission resumed"); }
  async clearMission(): Promise<CommandResult> { return ok("Mission cleared"); }
  async commitParamsToFlash(): Promise<CommandResult> { return ok("Params saved to flash"); }
  async setHome(): Promise<CommandResult> { return ok("Home set"); }
  async changeSpeed(): Promise<CommandResult> { return ok("Speed changed"); }
  async setYaw(): Promise<CommandResult> { return ok("Yaw set"); }
  async setGeoFenceEnabled(): Promise<CommandResult> { return ok("Geofence updated"); }
  async setServo(): Promise<CommandResult> { return ok("Servo set"); }
  async cameraTrigger(): Promise<CommandResult> { return ok("Camera triggered"); }
  async setGimbalAngle(): Promise<CommandResult> { return ok("Gimbal set"); }
  async setCameraTriggerDistance(): Promise<CommandResult> { return ok("Camera trigger distance set"); }
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
    return { ok: true };
  }
  async startEscCalibration(): Promise<CommandResult> { this.emitStatusText(3, "WARNING: ESC calibration will spin motors! Remove props!"); return ok("ESC calibration started"); }
  async enableFence(): Promise<CommandResult> { return ok("Fence updated"); }
  async doLandStart(): Promise<CommandResult> { return ok("Land start"); }
  async controlVideo(): Promise<CommandResult> { return ok("Video control"); }
  async setRelay(): Promise<CommandResult> { return ok("Relay set"); }
  async startRxPair(): Promise<CommandResult> { return ok("RX pair started"); }
  async setMessageInterval(): Promise<CommandResult> { return ok("Interval set"); }
  async sendCommand(): Promise<CommandResult> { return ok("Command sent"); }
  sendManualControl(roll: number, pitch: number, throttle: number, yaw: number, buttons: number): void {
    this._lastManualControl = { roll, pitch, throttle, yaw, buttons };
  }
  sendPositionTarget(lat: number, lon: number, alt: number): void {
    this._lastPositionTarget = { lat, lon, alt };
  }
  sendAttitudeTarget(roll: number, pitch: number, yaw: number, thrust: number): void {
    this._lastAttitudeTarget = { roll, pitch, yaw, thrust };
  }
  setRcChannelValues(channels: number[]): void { this._rcChannelValues = channels; }

  /** Last stick frame handed to this mock, or null if none. */
  getLastManualControl(): ManualControlSample | null { return this._lastManualControl; }
  /** Last guided position setpoint handed to this mock, or null if none. */
  getLastPositionTarget(): PositionTargetSample | null { return this._lastPositionTarget; }
  /** Last attitude setpoint handed to this mock, or null if none. */
  getLastAttitudeTarget(): AttitudeTargetSample | null { return this._lastAttitudeTarget; }

  async doPreArmCheck(): Promise<CommandResult> {
    const names = ["Roll", "Pitch", "Throttle", "Yaw"];
    let fail = false;
    for (let ch = 1; ch <= 4; ch++) {
      const trim = this.params.get(`RC${ch}_TRIM`)?.value ?? 1500;
      const dz = this.params.get(`RC${ch}_DZ`)?.value ?? 30;
      if (Math.abs((this._rcChannelValues[ch - 1] ?? 1500) - trim) > dz) {
        fail = true;
        setTimeout(() => this.emitStatusText(4, `Arm: ${names[ch - 1]} (RC${ch}) is not neutral`), 100 * ch);
      }
    }
    if (!fail) setTimeout(() => this.emitStatusText(6, "PreArm: Ready to arm"), 200);
    return ok("Pre-arm check");
  }

  // ── Fence / Rally ──────────────────────────────────────
  async uploadFence(): Promise<CommandResult> { await new Promise((r) => setTimeout(r, 500)); this.emitStatusText(6, "Fence uploaded"); return ok("Fence uploaded"); }
  async downloadFence() { return MOCK_FENCE_POLYGON; }
  // PX4 stores the geofence as a mission plan (mission_type = fence). Round-trip
  // the uploaded elements so the demo mission-fence path is real, not a no-op.
  async uploadFenceMission(elements: FenceElement[]): Promise<CommandResult> {
    await new Promise((r) => setTimeout(r, 500));
    this.fenceElements = elements.map((el) => ({ ...el }));
    this.emitStatusText(6, `Fence uploaded (${elements.length} elements)`);
    return ok("Fence uploaded");
  }
  async downloadFenceMission(): Promise<FenceElement[]> {
    if (this.fenceElements.length > 0) return this.fenceElements.map((el) => ({ ...el }));
    // No fence uploaded yet: return the mock polygon as a single inclusion zone.
    return [{
      kind: "polygon",
      role: "inclusion",
      vertices: MOCK_FENCE_POLYGON.map((p) => ({ lat: p.lat, lon: p.lon })),
    }];
  }
  async uploadRallyPoints(pts: Array<{ lat: number; lon: number; alt: number }>): Promise<CommandResult> { await new Promise((r) => setTimeout(r, 300)); this.rallyPoints = [...pts]; this.emitStatusText(6, `${pts.length} rally points uploaded`); return ok("Rally points uploaded"); }
  async downloadRallyPoints() { return [...this.rallyPoints]; }

  // ── Parameters ─────────────────────────────────────────
  getCachedParameterNames(): string[] { return Array.from(this.params.keys()); }
  async getAllParameters(): Promise<ParameterValue[]> {
    const all = Array.from(this.params.values()), count = all.length;
    for (let i = 0; i < all.length; i++) { const p = all[i]; for (const cb of this.cbs.parameterCbs) cb({ name: p.name, value: p.value, type: p.type, index: i, count }); }
    return all.map((p, i) => ({ name: p.name, value: p.value, type: p.type, index: i, count }));
  }
  async getParameter(name: string): Promise<ParameterValue> {
    const p = this.params.get(name);
    if (!p) return { name, value: 0, type: 9, index: -1, count: this.params.size };
    return { name: p.name, value: p.value, type: p.type, index: Array.from(this.params.keys()).indexOf(name), count: this.params.size };
  }
  async setParameter(name: string, value: number, type = 9): Promise<CommandResult> {
    const existing = this.params.get(name);
    if (existing) existing.value = value; else this.params.set(name, { name, value, type });
    const pv: ParameterValue = { name, value, type, index: Array.from(this.params.keys()).indexOf(name), count: this.params.size };
    for (const cb of this.cbs.parameterCbs) cb(pv);
    return ok(`${name} = ${value}`);
  }
  async resetParametersToDefault(): Promise<CommandResult> {
    this.params.clear(); for (const p of this.defaults) this.params.set(p.name, { ...p });
    this.emitStatusText(5, "Parameters reset to defaults"); return ok("Parameters reset");
  }

  // ── Mission ────────────────────────────────────────────
  async uploadMission(): Promise<CommandResult> { return ok("Mission uploaded"); }
  async downloadMission(): Promise<MissionItem[]> { await new Promise((r) => setTimeout(r, 800)); return getMockMission(); }
  async setCurrentMissionItem(): Promise<CommandResult> { return ok("Mission item set"); }

  // ── Calibration (delegated) ────────────────────────────
  async startCalibration(type: "accel" | "gyro" | "compass" | "level" | "airspeed" | "baro" | "rc" | "esc" | "compassmot"): Promise<CommandResult> {
    const ctx: CalibrationContext = {
      vehicleFirmwareType: this._vehicleInfo.firmwareType, isPX4: this._vehicleInfo.firmwareType === "px4",
      accelCalTimers: this.accelCalTimers, compassCalTimers: this.compassCalTimers,
      magCalProgressCbs: this.cbs.magCalProgressCbs, magCalReportCbs: this.cbs.magCalReportCbs, accelCalPosCbs: this.cbs.accelCalPosCbs,
      emitStatusText: (s, t) => this.emitStatusText(s, t), emitAccelCalPos: (p) => E.emitAccelCalPos(this.cbs, p),
      clearAccelTimers: () => this.clearAccelTimers(), clearCompassTimers: () => this.clearCompassTimers(),
    };
    return mockStartCalibration(ctx, type);
  }
  confirmAccelCalPos(position: number): void {
    const t = setTimeout(() => {
      if (position + 1 <= 6) E.emitAccelCalPos(this.cbs, (position + 1) as AccelCalPosition);
      else { this.emitStatusText(5, "Calibration successful"); setTimeout(() => this.emitStatusText(5, "PreArm: Accels calibrated requires reboot"), 200); }
    }, 800);
    this.accelCalTimers.push(t);
  }
  async acceptCompassCal(): Promise<CommandResult> { return ok("Compass calibration accepted"); }
  async cancelCompassCal(): Promise<CommandResult> { this.clearCompassTimers(); return ok("Compass calibration cancelled"); }
  async cancelCalibration(): Promise<CommandResult> { this.clearAccelTimers(); return ok("Calibration cancelled"); }
  async startGnssMagCal(): Promise<CommandResult> {
    this.emitStatusText(6, "[cal] calibration started: 2");
    setTimeout(() => { this.emitStatusText(6, "[cal] progress <50>"); setTimeout(() => this.emitStatusText(6, "[cal] calibration done: mag"), 1000); }, 500);
    return ok("GNSS mag calibration started");
  }
  private clearAccelTimers(): void { for (const t of this.accelCalTimers) clearTimeout(t); this.accelCalTimers = []; }
  private clearCompassTimers(): void { for (const t of this.compassCalTimers) { clearTimeout(t as ReturnType<typeof setTimeout>); clearInterval(t as ReturnType<typeof setInterval>); } this.compassCalTimers = []; }

  // ── Log Download ───────────────────────────────────────
  async getLogList(): Promise<LogEntry[]> { return getMockLogList(); }
  async downloadLog(_id: number, onProgress?: LogDownloadProgressCallback): Promise<Uint8Array> {
    const total = 4096, chunk = 90;
    for (let i = 0; i < Math.ceil(total / chunk); i++) { await new Promise((r) => setTimeout(r, 100)); if (onProgress) onProgress(Math.min((i + 1) * chunk, total), total); }
    const data = new Uint8Array(total); data[0] = 0xa3; data[1] = 0x95; return data;
  }
  async eraseAllLogs(): Promise<CommandResult> { this.emitStatusText(6, "All logs erased"); return ok("Logs erased"); }
  cancelLogDownload(): void {}
  async downloadFileViaFtp(_path: string, onProgress?: FtpDownloadProgressCallback): Promise<Uint8Array> {
    const total = 2048, chunk = 239;
    const data = new Uint8Array(total);
    for (let i = 0; i < total; i++) data[i] = i & 0xff;
    for (let ofs = 0; ofs < total; ofs += chunk) {
      await new Promise((r) => setTimeout(r, 60));
      if (onProgress) onProgress(Math.min(ofs + chunk, total), total);
    }
    return data;
  }

  /** In-memory FC file store so the Scripts tab round-trips in demo mode. */
  private _mockFtpFiles = new Map<string, number>([
    ["APM/scripts/rangefinder_test.lua", 1420],
    ["APM/scripts/hello_world.lua", 210],
  ]);

  async uploadFileViaFtp(path: string, bytes: Uint8Array, onProgress?: (written: number, total: number) => void): Promise<void> {
    const total = bytes.length;
    for (let ofs = 0; ofs <= total; ofs += 239) {
      await new Promise((r) => setTimeout(r, 40));
      if (onProgress) onProgress(Math.min(ofs + 239, total), total);
    }
    this._mockFtpFiles.set(path, total);
  }

  async listDirectoryViaFtp(path: string): Promise<FtpDirEntry[]> {
    await new Promise((r) => setTimeout(r, 120));
    const prefix = path.endsWith("/") ? path : path + "/";
    return [...this._mockFtpFiles.entries()]
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, size]) => ({ name: p.slice(prefix.length), size, isDir: false }));
  }

  async removeFileViaFtp(path: string): Promise<void> {
    await new Promise((r) => setTimeout(r, 80));
    this._mockFtpFiles.delete(path);
  }

  /** Demo mode never has a real FC-served metadata overlay. */
  getComponentMetadataUri(): string | null { return null; }

  // ── Betaflight LED strip (mock) ────────────────────────
  async getLedStripConfig(): Promise<number[]> {
    // 8 LEDs, palette colour index cycling 0..7 (color field = bits 22..25).
    return Array.from({ length: 8 }, (_, i) => (i << 22) >>> 0);
  }
  async setLedStripConfig(): Promise<CommandResult> { return ok("LED config written"); }
  async getLedColors() {
    // A 16-entry rainbow palette.
    return Array.from({ length: 16 }, (_, i) => ({ h: Math.round((i * 360) / 16), s: 255, v: 255 }));
  }
  async setLedColors(): Promise<CommandResult> { return ok("LED colours written"); }
  async getLedStripModeColors() {
    const out: { mode: number; fun: number; color: number }[] = [];
    for (let mode = 0; mode < 6; mode++)
      for (let dir = 0; dir < 6; dir++) out.push({ mode, fun: dir, color: (mode + dir) % 16 });
    for (let fun = 0; fun < 11; fun++) out.push({ mode: 6, fun, color: fun % 16 });
    out.push({ mode: 7, fun: 0, color: 0 });
    return out;
  }
  async setLedStripModeColor(): Promise<CommandResult> { return ok("Mode colour written"); }

  // ── Betaflight serial ports (mock, MSP2 32-bit mask) ───
  async getSerialConfig() {
    return [
      { identifier: 20, functions: 1, mspBaudRate: 0, gpsBaudRate: 0, telemetryBaudRate: 0, blackboxBaudRate: 0 }, // USB VCP: MSP
      { identifier: 51, functions: 1 << 16, mspBaudRate: 5, gpsBaudRate: 0, telemetryBaudRate: 0, blackboxBaudRate: 0 }, // UART1: FrSky OSD (bit 16)
      { identifier: 52, functions: 1 << 6, mspBaudRate: 0, gpsBaudRate: 5, telemetryBaudRate: 0, blackboxBaudRate: 0 }, // UART2: Serial RX
    ];
  }
  async setSerialConfig(): Promise<CommandResult> { return ok("Serial config written"); }
  serialConfigExtended(): boolean { return true; }
  async sendDshotCommand(): Promise<CommandResult> { return ok("DShot command sent"); }
  async uploadOsdFont(glyphs: Uint8Array[], onProgress?: (done: number, total: number) => void): Promise<CommandResult> { onProgress?.(glyphs.length, glyphs.length); return ok(`Uploaded ${glyphs.length} font glyphs`); }

  // ── DisplayPort OSD push (mock) ────────────────────────
  onDisplayPort(cb: (op: DisplayPortOp) => void): () => void {
    let t = 0;
    const write = (row: number, col: number, text: string) =>
      cb({ kind: "writeString", row, col, attr: 0, fontPage: 0, blink: false, text });
    const emit = () => {
      t++;
      const alt = 100 + (t % 25);
      const batt = (16.8 - (t % 60) * 0.02).toFixed(1);
      cb({ kind: "clear" });
      write(1, 8, "ADOS DEMO OSD");
      write(4, 2, `ALT ${alt}m`);
      write(4, 20, "SPD 12m/s");
      write(6, 2, `BAT ${batt}V`);
      write(6, 20, "SAT 17");
      write(14, 9, "RTH 0.42km");
      cb({ kind: "draw" });
    };
    emit();
    const id = setInterval(emit, 500);
    this.tickTimers.push(id);
    return () => clearInterval(id);
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
    if (messageId === 148) setTimeout(() => this.emitAutopilotVersion({ capabilities: 0xFF, flightSwVersion: 0x04050007, middlewareSwVersion: 0, osSwVersion: 0, boardVersion: 1032, uid: 0 }), 0);
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
  onAccelCalPos = this._on.onAccelCalPos; onHomePosition = this._on.onHomePosition;
  onAutopilotVersion = this._on.onAutopilotVersion; onPowerStatus = this._on.onPowerStatus;
  onDistanceSensor = this._on.onDistanceSensor; onFenceStatus = this._on.onFenceStatus;
  onNavController = this._on.onNavController; onScaledImu = this._on.onScaledImu;
  onScaledPressure = this._on.onScaledPressure; onEstimatorStatus = this._on.onEstimatorStatus;
  onCameraTrigger = this._on.onCameraTrigger; onLinkLost = this._on.onLinkLost;
  onLinkRestored = this._on.onLinkRestored; onLocalPosition = this._on.onLocalPosition;
  onDebug = this._on.onDebug; onGimbalAttitude = this._on.onGimbalAttitude;
  onObstacleDistance = this._on.onObstacleDistance; onCameraImageCaptured = this._on.onCameraImageCaptured;
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
  getFirmwareHandler(): FirmwareHandler { return this.handler; }
}
