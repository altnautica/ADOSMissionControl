/**
 * MockProtocol — Full DroneProtocol implementation for demo mode.
 *
 * @license GPL-3.0-only
 */

import type {
  DroneProtocol, Transport, VehicleInfo, CommandResult, ParameterValue,
  ProtocolCapabilities, FirmwareHandler, MissionItem, UnifiedFlightMode,
  LogEntry, LogDownloadProgressCallback, AccelCalPosition,
  SysStatusCallback, RadioCallback, EkfCallback, VibrationCallback,
  ServoOutputCallback, WindCallback, TerrainCallback, ScaledImuCallback,
  ScaledPressureCallback, HomePositionCallback, PowerStatusCallback,
  DistanceSensorCallback, FenceStatusCallback, EstimatorStatusCallback,
  CameraTriggerCallback, NavControllerCallback, LocalPositionCallback,
  DebugCallback, GimbalAttitudeCallback, ObstacleDistanceCallback,
  CameraImageCapturedCallback, ExtendedSysStateCallback, FencePointCallback,
  SystemTimeCallback, AutopilotVersionCallback,
} from "@/lib/protocol/types";
import { ArduCopterHandler } from "@/lib/protocol/firmware/ardupilot";
import { PX4Handler } from "@/lib/protocol/firmware/px4";
import { betaflightHandler } from "@/lib/protocol/firmware/betaflight";
import { MOCK_PARAMS, PX4_MOCK_PARAMS, BETAFLIGHT_MOCK_PARAMS, type MockParam } from "./mock-params";
import { createCallbackArrays, bindOnMethods } from "./mock-protocol-callbacks";
import * as E from "./mock-protocol-emitters";
import { mockStartCalibration, type CalibrationContext } from "./mock-protocol-calibration";
import { handleSerialCommand, startTelemetryTick, type TelemetryTickContext } from "./mock-protocol-serial";
import { MOCK_FENCE_POLYGON, MOCK_VEHICLE_INFO, PX4_VEHICLE_INFO, BETAFLIGHT_VEHICLE_INFO, getMockMission, getMockLogList } from "./mock-protocol-data";

export { MOCK_FENCE_POLYGON } from "./mock-protocol-data";

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
  private rallyPoints: Array<{ lat: number; lon: number; alt: number }> = [];

  constructor(firmwareType: 'ardupilot-copter' | 'px4' | 'betaflight' = 'ardupilot-copter') {
    if (firmwareType === 'px4') { this.handler = new PX4Handler(); this.defaults = PX4_MOCK_PARAMS; this._vehicleInfo = PX4_VEHICLE_INFO; }
    else if (firmwareType === 'betaflight') { this.handler = betaflightHandler; this.defaults = BETAFLIGHT_MOCK_PARAMS; this._vehicleInfo = BETAFLIGHT_VEHICLE_INFO; }
    else { this.handler = new ArduCopterHandler(); this.defaults = MOCK_PARAMS; this._vehicleInfo = MOCK_VEHICLE_INFO; }
    this.params = new Map();
    for (const p of this.defaults) this.params.set(p.name, { ...p });
  }

  // ── Emit methods (called by engine) ────────────────────
  emitStatusText(severity: number, text: string): void { E.emitStatusText(this.cbs, severity, text); }
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

  // ── Connection ─────────────────────────────────────────
  get isConnected(): boolean { return this._connected; }
  async connect(_t: Transport): Promise<VehicleInfo> { this._connected = true; return this._vehicleInfo; }
  async disconnect(): Promise<void> { this._connected = false; }

  // ── Commands ───────────────────────────────────────────
  async arm(): Promise<CommandResult> { this.emitStatusText(6, "Arming motors"); return ok("Armed"); }
  async disarm(): Promise<CommandResult> { this.emitStatusText(6, "Disarming motors"); return ok("Disarmed"); }
  async setFlightMode(m: UnifiedFlightMode): Promise<CommandResult> { this.emitStatusText(6, `Mode change to ${m}`); return ok(`Mode: ${m}`); }
  async returnToLaunch(): Promise<CommandResult> { this.emitStatusText(6, "Returning to launch"); return ok("RTL"); }
  async land(): Promise<CommandResult> { this.emitStatusText(6, "Landing"); return ok("Landing"); }
  async takeoff(alt: number): Promise<CommandResult> { this.emitStatusText(6, `Taking off to ${alt}m`); return ok(`Takeoff ${alt}m`); }
  async killSwitch(): Promise<CommandResult> { this.emitStatusText(2, "KILL SWITCH ACTIVATED"); return ok("Kill switch"); }
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
  async startEscCalibration(): Promise<CommandResult> { this.emitStatusText(3, "WARNING: ESC calibration will spin motors! Remove props!"); return ok("ESC calibration started"); }
  async startCompassMotCal(): Promise<CommandResult> { this.emitStatusText(6, "CompassMot calibration started — increase throttle slowly"); return ok("CompassMot calibration started"); }
  async enableFence(): Promise<CommandResult> { return ok("Fence updated"); }
  async doLandStart(): Promise<CommandResult> { return ok("Land start"); }
  async controlVideo(): Promise<CommandResult> { return ok("Video control"); }
  async setRelay(): Promise<CommandResult> { return ok("Relay set"); }
  async startRxPair(): Promise<CommandResult> { return ok("RX pair started"); }
  async setMessageInterval(): Promise<CommandResult> { return ok("Interval set"); }
  async sendCommand(): Promise<CommandResult> { return ok("Command sent"); }
  sendManualControl(): void {}
  sendPositionTarget(): void {}
  sendAttitudeTarget(): void {}
  setRcChannelValues(channels: number[]): void { this._rcChannelValues = channels; }

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

  // ── Motor Test / Reboot ────────────────────────────────
  async motorTest(motor: number, throttle: number, duration: number): Promise<CommandResult> { this.emitStatusText(6, `Motor ${motor} test: ${throttle}% for ${duration}s`); return ok(`Motor ${motor} tested`); }
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
  onStatusText = this._on.onStatusText; onHeartbeat = this._on.onHeartbeat;
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

  // ── Info ───────────────────────────────────────────────
  getVehicleInfo(): VehicleInfo { return this._vehicleInfo; }
  getCapabilities(): ProtocolCapabilities { return this.handler.getCapabilities(); }
  getFirmwareHandler(): FirmwareHandler { return this.handler; }
}
