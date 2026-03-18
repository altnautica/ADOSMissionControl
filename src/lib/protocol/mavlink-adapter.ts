/**
 * MAVLink v2 protocol adapter for Altnautica Command GCS.
 *
 * Thin composition class that implements `DroneProtocol` by delegating to:
 * - mavlink-adapter-callbacks.ts (subscription methods)
 * - mavlink-adapter-commands.ts (MAV_CMD sending)
 * - mavlink-adapter-params.ts (parameter protocol)
 * - mavlink-adapter-missions.ts (mission/rally/fence protocol)
 * - mavlink-adapter-logs.ts (log download protocol)
 * - mavlink-adapter-frame-handlers.ts (incoming frame routing + state machines)
 *
 * @module protocol/mavlink-adapter
 */

import type {
  DroneProtocol, Transport, VehicleInfo, CommandResult, ParameterValue,
  MissionItem, FirmwareHandler, ProtocolCapabilities, UnifiedFlightMode,
  LogEntry, LogDownloadProgressCallback,
} from './types'
import { MAVLinkParser, type MAVLinkFrame } from './mavlink-parser'
import { encodeHeartbeat } from './mavlink-encoder'
import { decodeHeartbeat } from './mavlink-messages'
import { CommandQueue } from './command-queue'
import { createFirmwareHandler } from './firmware/ardupilot'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'
import { createCallbackStore, bindCallbackMethods } from './mavlink-adapter-callbacks'
import { routeFrame, checkLinkState, requestDataStreams, MSG_NAMES, type FrameHandlerState } from './mavlink-adapter-frame-handlers'
import * as cmds from './mavlink-adapter-commands'
import * as prm from './mavlink-adapter-params'
import * as msn from './mavlink-adapter-missions'
import * as logOps from './mavlink-adapter-logs'

export class MAVLinkAdapter implements DroneProtocol {
  readonly protocolName = 'mavlink'

  // Internal state
  private parser = new MAVLinkParser()
  private commandQueue = new CommandQueue(3000)
  private transport: Transport | null = null
  private firmwareHandler: FirmwareHandler | null = null
  private vehicleInfo: VehicleInfo | null = null
  private targetSysId = 1
  private targetCompId = 1
  private sysId = 255
  private compId = 190
  private _connected = false
  private _disconnected = false
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private streamRequestInterval: ReturnType<typeof setInterval> | null = null
  private dataHandler: ((data: Uint8Array) => void) | null = null
  private closeHandler: (() => void) | null = null
  private cbs = createCallbackStore()
  private cbm = bindCallbackMethods(this.cbs)
  private paramCache = new Map<string, { value: number; timestamp: number }>()
  private lastVehicleHeartbeat = 0
  private linkLostCheckInterval: ReturnType<typeof setInterval> | null = null
  private linkIsLost = false

  // Protocol state machines
  private parameterDownload: prm.ParamDownloadState | null = null
  private missionUpload: msn.MissionUploadState | null = null
  private missionDownload: msn.MissionDownloadState | null = null
  private rallyUpload: msn.RallyUploadState | null = null
  private rallyDownload: msn.RallyDownloadState | null = null
  private logListDownload: logOps.LogListState | null = null
  private logDataDownload: logOps.LogDataState | null = null

  get isConnected(): boolean { return this._connected }

  // ── Shared state object for frame handlers ──────────────
  // Cached mutable object — updated in-place to avoid 50+/sec allocations
  private _fhs: FrameHandlerState = {
    transport: null, firmwareHandler: null, vehicleInfo: null,
    targetSysId: 1, targetCompId: 1, sysId: 255, compId: 190,
    commandQueue: this.commandQueue, cbs: this.cbs, paramCache: this.paramCache,
    parameterDownload: null, missionUpload: null, missionDownload: null,
    rallyUpload: null, rallyDownload: null, logListDownload: null, logDataDownload: null,
    lastVehicleHeartbeat: 0, linkIsLost: false, HEARTBEAT_TIMEOUT_MS: 5000,
  }
  private get fhs(): FrameHandlerState {
    const s = this._fhs
    s.transport = this.transport; s.firmwareHandler = this.firmwareHandler; s.vehicleInfo = this.vehicleInfo
    s.targetSysId = this.targetSysId; s.targetCompId = this.targetCompId; s.sysId = this.sysId; s.compId = this.compId
    s.parameterDownload = this.parameterDownload; s.missionUpload = this.missionUpload
    s.missionDownload = this.missionDownload; s.rallyUpload = this.rallyUpload; s.rallyDownload = this.rallyDownload
    s.logListDownload = this.logListDownload; s.logDataDownload = this.logDataDownload
    s.lastVehicleHeartbeat = this.lastVehicleHeartbeat; s.linkIsLost = this.linkIsLost
    return s
  }
  private syncFhs(s: FrameHandlerState) {
    this.vehicleInfo = s.vehicleInfo; this.parameterDownload = s.parameterDownload
    this.missionUpload = s.missionUpload; this.missionDownload = s.missionDownload
    this.rallyUpload = s.rallyUpload; this.rallyDownload = s.rallyDownload
    this.logListDownload = s.logListDownload; this.logDataDownload = s.logDataDownload
    this.lastVehicleHeartbeat = s.lastVehicleHeartbeat; this.linkIsLost = s.linkIsLost
  }

  // ── Connection ─────────────────────────────────────────
  async connect(transport: Transport): Promise<VehicleInfo> {
    this.transport = transport; this._disconnected = false
    this.dataHandler = (data: Uint8Array) => this.parser.feed(data)
    this.closeHandler = () => this.handleDisconnect()
    transport.on('data', this.dataHandler)
    transport.on('close', this.closeHandler as (data: void) => void)
    this.parser.onFrame((frame) => this.handleFrame(frame))

    const vehicleInfo = await new Promise<VehicleInfo>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No heartbeat received within 10 seconds')), 10000)
      const unsub = this.parser.onFrame((frame) => {
        if (frame.msgId === 0) {
          const hb = decodeHeartbeat(frame.payload)
          if (hb.type === 6) return
          clearTimeout(timeout); unsub()
          this.targetSysId = frame.systemId; this.targetCompId = frame.componentId
          this.firmwareHandler = createFirmwareHandler(hb.autopilot, hb.type)
          const info: VehicleInfo = {
            firmwareType: this.firmwareHandler.firmwareType, vehicleClass: this.firmwareHandler.vehicleClass,
            firmwareVersionString: this.firmwareHandler.getFirmwareVersion(),
            systemId: frame.systemId, componentId: frame.componentId,
            autopilotType: hb.autopilot, vehicleType: hb.type,
          }
          this.vehicleInfo = info; resolve(info)
        }
      })
    })

    this._connected = true
    this.heartbeatInterval = setInterval(() => {
      if (this.transport?.isConnected) this.transport.send(encodeHeartbeat(this.sysId, this.compId))
    }, 1000)
    this.transport.send(encodeHeartbeat(this.sysId, this.compId))
    requestDataStreams(this.fhs)
    this.streamRequestInterval = setInterval(() => requestDataStreams(this.fhs), 10000)
    this.lastVehicleHeartbeat = Date.now(); this.linkIsLost = false
    this.linkLostCheckInterval = setInterval(() => { const s = this.fhs; checkLinkState(s); this.syncFhs(s) }, 1000)
    this.sendCommandLong(512, [242, 0, 0, 0, 0, 0, 0]).catch(() => {})
    this.sendCommandLong(512, [148, 0, 0, 0, 0, 0, 0]).catch(() => {})
    return vehicleInfo
  }

  async disconnect(): Promise<void> {
    this.handleDisconnect()
    if (this.transport?.isConnected) await this.transport.disconnect()
  }

  private handleDisconnect(): void {
    if (this._disconnected) return
    this._disconnected = true; this._connected = false
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null }
    if (this.streamRequestInterval) { clearInterval(this.streamRequestInterval); this.streamRequestInterval = null }
    if (this.linkLostCheckInterval) { clearInterval(this.linkLostCheckInterval); this.linkLostCheckInterval = null }
    this.commandQueue.clear(); this.paramCache.clear(); this.parser.reset()
    if (this.logListDownload) { clearTimeout(this.logListDownload.timer); this.logListDownload.resolve(Array.from(this.logListDownload.entries.values())); this.logListDownload = null }
    if (this.logDataDownload) { if (this.logDataDownload.inactivityTimer) clearTimeout(this.logDataDownload.inactivityTimer); clearTimeout(this.logDataDownload.hardTimer); this.logDataDownload.reject(new Error('Disconnected during log download')); this.logDataDownload = null }
    if (this.transport && this.dataHandler) { this.transport.off('data', this.dataHandler); this.transport.off('close', this.closeHandler as (data: void) => void) }
    this.transport = null
  }

  /** Set to true when the MAVLink Inspector / diagnostics panel is open. */
  diagnosticsEnabled = false

  private handleFrame(frame: MAVLinkFrame): void {
    const startTime = performance.now()
    const diag = useDiagnosticsStore.getState(); diag.recordParseEvent()
    const msgName = MSG_NAMES[frame.msgId] ?? `MSG_${frame.msgId}`
    let rawHex: string | undefined
    if (this.diagnosticsEnabled) {
      const pb = new Uint8Array(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength)
      rawHex = Array.from(pb.slice(0, 32)).map((b) => b.toString(16).padStart(2, '0')).join(' ') + (pb.length > 32 ? ' ...' : '')
    }
    diag.logMessage(frame.msgId, msgName, 'in', frame.payload.byteLength, rawHex)
    const s = this.fhs; routeFrame(s, frame, frame.payload); this.syncFhs(s)
    diag.recordFrameProcessingTime(performance.now() - startTime)
  }

  // ── Context helpers ────────────────────────────────────
  private get cc(): cmds.CommandContext { return { transport: this.transport, firmwareHandler: this.firmwareHandler, commandQueue: this.commandQueue, targetSysId: this.targetSysId, targetCompId: this.targetCompId, sysId: this.sysId, compId: this.compId, sendCommandLong: this.sendCommandLong.bind(this) } }
  private get pc(): prm.ParamContext { return { transport: this.transport, firmwareHandler: this.firmwareHandler, targetSysId: this.targetSysId, targetCompId: this.targetCompId, sysId: this.sysId, compId: this.compId, paramCache: this.paramCache, PARAM_CACHE_TTL_MS: 300000, parameterDownload: this.parameterDownload, onParameter: this.onParameter.bind(this) } }
  private get mc(): msn.MissionContext { return { transport: this.transport, firmwareHandler: this.firmwareHandler, targetSysId: this.targetSysId, targetCompId: this.targetCompId, sysId: this.sysId, compId: this.compId, missionUpload: this.missionUpload, missionDownload: this.missionDownload, rallyUpload: this.rallyUpload, rallyDownload: this.rallyDownload, sendCommandLong: this.sendCommandLong.bind(this), onParameter: this.onParameter.bind(this), onFencePoint: this.onFencePoint.bind(this), getParameter: this.getParameter.bind(this) } }
  private get lc(): logOps.LogContext { return { transport: this.transport, targetSysId: this.targetSysId, targetCompId: this.targetCompId, sysId: this.sysId, compId: this.compId, logListDownload: this.logListDownload, logDataDownload: this.logDataDownload } }

  // ── Delegated Commands ─────────────────────────────────
  async arm() { return cmds.cmdArm(this.cc) }
  async disarm() { return cmds.cmdDisarm(this.cc) }
  async setFlightMode(m: UnifiedFlightMode) { return cmds.cmdSetFlightMode(this.cc, m) }
  async returnToLaunch() { return cmds.cmdReturnToLaunch(this.cc) }
  async land() { return cmds.cmdLand(this.cc) }
  async takeoff(alt: number) { return cmds.cmdTakeoff(this.cc, alt) }
  sendManualControl(r: number, p: number, t: number, y: number, b: number) { cmds.cmdSendManualControl(this.cc, r, p, t, y, b) }
  async startCalibration(type: 'accel'|'gyro'|'compass'|'level'|'airspeed'|'baro'|'rc'|'esc'|'compassmot') { return cmds.cmdStartCalibration(this.cc, type) }
  confirmAccelCalPos(pos: number) { cmds.cmdConfirmAccelCalPos(this.cc, pos) }
  async acceptCompassCal(mask = 0) { return cmds.cmdAcceptCompassCal(this.cc, mask) }
  async cancelCompassCal(mask = 0) { return cmds.cmdCancelCompassCal(this.cc, mask) }
  async cancelCalibration() { return cmds.cmdCancelCalibration(this.cc) }
  async startGnssMagCal() { return cmds.cmdStartGnssMagCal(this.cc) }
  async sendCommand(id: number, p: number[]) { return cmds.cmdSendCommand(this.cc, id, p) }
  async motorTest(m: number, t: number, d: number) { return cmds.cmdMotorTest(this.cc, m, t, d) }
  async rebootToBootloader() { return cmds.cmdRebootToBootloader(this.cc) }
  async reboot() { return cmds.cmdReboot(this.cc) }
  async resetParametersToDefault() { return cmds.cmdResetParametersToDefault(this.cc) }
  async killSwitch() { return cmds.cmdKillSwitch(this.cc) }
  async guidedGoto(lat: number, lon: number, alt: number) { return cmds.cmdGuidedGoto(this.cc, lat, lon, alt) }
  async pauseMission() { return cmds.cmdPauseMission(this.cc) }
  async resumeMission() { return cmds.cmdResumeMission(this.cc) }
  async commitParamsToFlash() { return cmds.cmdCommitParamsToFlash(this.cc) }
  async setHome(uc: boolean, lat = 0, lon = 0, alt = 0) { return cmds.cmdSetHome(this.cc, uc, lat, lon, alt) }
  async changeSpeed(st: number, sp: number) { return cmds.cmdChangeSpeed(this.cc, st, sp) }
  async setYaw(a: number, s: number, d: number, r: boolean) { return cmds.cmdSetYaw(this.cc, a, s, d, r) }
  async setGeoFenceEnabled(e: boolean) { return cmds.cmdSetGeoFenceEnabled(this.cc, e) }
  async setServo(n: number, p: number) { return cmds.cmdSetServo(this.cc, n, p) }
  async cameraTrigger() { return cmds.cmdCameraTrigger(this.cc) }
  async setGimbalAngle(p: number, r: number, y: number) { return cmds.cmdSetGimbalAngle(this.cc, p, r, y) }
  async setGimbalMode(m: number) { return cmds.cmdSetGimbalMode(this.cc, m) }
  async doPreArmCheck() { return cmds.cmdDoPreArmCheck(this.cc) }
  async enableFence(e: boolean) { return cmds.cmdEnableFence(this.cc, e) }
  async doLandStart() { return cmds.cmdDoLandStart(this.cc) }
  async controlVideo(p: { cameraId: number; transmission: number; channel: number; recording: number }) { return cmds.cmdControlVideo(this.cc, p) }
  async setRelay(n: number, on: boolean) { return cmds.cmdSetRelay(this.cc, n, on) }
  async startRxPair(s: number) { return cmds.cmdStartRxPair(this.cc, s) }
  async requestMessage(id: number) { return cmds.cmdRequestMessage(this.cc, id) }
  async setMessageInterval(id: number, us: number) { return cmds.cmdSetMessageInterval(this.cc, id, us) }
  async startCompassMotCal() { return cmds.cmdStartCompassMotCal(this.cc) }
  sendSerialData(t: string) { cmds.cmdSendSerialData(this.cc, t) }
  sendPositionTarget(lat: number, lon: number, alt: number) { cmds.cmdSendPositionTarget(this.cc, lat, lon, alt) }
  sendAttitudeTarget(r: number, p: number, y: number, t: number) { cmds.cmdSendAttitudeTarget(this.cc, r, p, y, t) }

  // ── Delegated Parameters ───────────────────────────────
  async getAllParameters() { const c = this.pc; const p = prm.getAllParameters(c); this.parameterDownload = c.parameterDownload; const r = await p; this.parameterDownload = c.parameterDownload; return r }
  getCachedParameterNames() { return prm.getCachedParameterNames(this.pc) }
  async getParameter(name: string) { return prm.getParameter(this.pc, name) }
  async setParameter(name: string, value: number, type = 9) { return prm.setParameter(this.pc, name, value, type) }

  // ── Delegated Missions ─────────────────────────────────
  async uploadMission(items: MissionItem[]) { const c = this.mc; const p = msn.uploadMission(c, items); this.missionUpload = c.missionUpload as msn.MissionUploadState | null; const r = await p; this.missionUpload = c.missionUpload as msn.MissionUploadState | null; return r }
  async downloadMission() { const c = this.mc; const p = msn.downloadMission(c); this.missionDownload = c.missionDownload as msn.MissionDownloadState | null; const r = await p; this.missionDownload = c.missionDownload as msn.MissionDownloadState | null; return r }
  async setCurrentMissionItem(seq: number) { return msn.setCurrentMissionItem(this.mc, seq) }
  async clearMission() { const c = this.mc; const r = await msn.clearMission(c); this.missionUpload = c.missionUpload as msn.MissionUploadState | null; return r }
  async uploadFence(pts: Array<{ lat: number; lon: number }>) { return msn.uploadFence(this.mc, pts) }
  async downloadFence() { return msn.downloadFence(this.mc) }
  async uploadRallyPoints(pts: Array<{ lat: number; lon: number; alt: number }>) { const c = this.mc; const p = msn.uploadRallyPoints(c, pts); this.rallyUpload = c.rallyUpload as msn.RallyUploadState | null; const r = await p; this.rallyUpload = c.rallyUpload as msn.RallyUploadState | null; return r }
  async downloadRallyPoints() { const c = this.mc; const p = msn.downloadRallyPoints(c); this.rallyDownload = c.rallyDownload as msn.RallyDownloadState | null; const r = await p; this.rallyDownload = c.rallyDownload as msn.RallyDownloadState | null; return r }

  // ── Delegated Logs ─────────────────────────────────────
  async getLogList() { const c = this.lc; const p = logOps.getLogList(c); this.logListDownload = c.logListDownload; const r = await p; this.logListDownload = c.logListDownload; return r }
  async downloadLog(id: number, onProgress?: LogDownloadProgressCallback) { const c = this.lc; const p = logOps.downloadLog(c, id, onProgress); this.logDataDownload = c.logDataDownload; const r = await p; this.logDataDownload = c.logDataDownload; return r }
  async eraseAllLogs() { return logOps.eraseAllLogs(this.lc) }
  cancelLogDownload() { const c = this.lc; logOps.cancelLogDownload(c); this.logListDownload = c.logListDownload; this.logDataDownload = c.logDataDownload }

  // ── Telemetry Subscriptions ────────────────────────────
  onAttitude = this.cbm.onAttitude; onPosition = this.cbm.onPosition; onBattery = this.cbm.onBattery
  onGps = this.cbm.onGps; onVfr = this.cbm.onVfr; onRc = this.cbm.onRc
  onStatusText = this.cbm.onStatusText; onHeartbeat = this.cbm.onHeartbeat
  onParameter = this.cbm.onParameter; onSerialData = this.cbm.onSerialData
  onSysStatus = this.cbm.onSysStatus; onRadio = this.cbm.onRadio
  onMissionProgress = this.cbm.onMissionProgress; onEkf = this.cbm.onEkf
  onVibration = this.cbm.onVibration; onServoOutput = this.cbm.onServoOutput
  onWind = this.cbm.onWind; onTerrain = this.cbm.onTerrain
  onMagCalProgress = this.cbm.onMagCalProgress; onMagCalReport = this.cbm.onMagCalReport
  onAccelCalPos = this.cbm.onAccelCalPos; onHomePosition = this.cbm.onHomePosition
  onAutopilotVersion = this.cbm.onAutopilotVersion; onPowerStatus = this.cbm.onPowerStatus
  onDistanceSensor = this.cbm.onDistanceSensor; onFenceStatus = this.cbm.onFenceStatus
  onNavController = this.cbm.onNavController; onScaledImu = this.cbm.onScaledImu
  onScaledPressure = this.cbm.onScaledPressure; onEstimatorStatus = this.cbm.onEstimatorStatus
  onCameraTrigger = this.cbm.onCameraTrigger; onLinkLost = this.cbm.onLinkLost
  onLinkRestored = this.cbm.onLinkRestored; onLocalPosition = this.cbm.onLocalPosition
  onDebug = this.cbm.onDebug; onGimbalAttitude = this.cbm.onGimbalAttitude
  onObstacleDistance = this.cbm.onObstacleDistance; onCameraImageCaptured = this.cbm.onCameraImageCaptured
  onExtendedSysState = this.cbm.onExtendedSysState; onFencePoint = this.cbm.onFencePoint
  onSystemTime = this.cbm.onSystemTime; onRawImu = this.cbm.onRawImu
  onRcChannelsRaw = this.cbm.onRcChannelsRaw; onRcChannelsOverride = this.cbm.onRcChannelsOverride
  onMissionItem = this.cbm.onMissionItem; onAltitude = this.cbm.onAltitude
  onWindCov = this.cbm.onWindCov; onAisVessel = this.cbm.onAisVessel
  onGimbalManagerInfo = this.cbm.onGimbalManagerInfo; onGimbalManagerStatus = this.cbm.onGimbalManagerStatus

  // ── Info ────────────────────────────────────────────────
  getVehicleInfo(): VehicleInfo | null { return this.vehicleInfo }
  getCapabilities(): ProtocolCapabilities {
    return this.firmwareHandler?.getCapabilities() ?? {
      supportsArming: false, supportsFlightModes: false, supportsMissionUpload: false, supportsMissionDownload: false,
      supportsManualControl: false, supportsParameters: false, supportsCalibration: false, supportsSerialPassthrough: false,
      supportsMotorTest: false, supportsGeoFence: false, supportsRally: false, supportsLogDownload: false,
      supportsOsd: false, supportsPidTuning: false, supportsPorts: false, supportsFailsafe: false,
      supportsPowerConfig: false, supportsReceiver: false, supportsFirmwareFlash: false, supportsCliShell: false,
      supportsMavlinkInspector: false, supportsGimbal: false, supportsCamera: false, supportsLed: false,
      supportsBattery2: false, supportsRangefinder: false, supportsOpticalFlow: false, supportsObstacleAvoidance: false,
      supportsDebugValues: false, supportsAuxModes: false, supportsVtx: false, supportsBlackbox: false,
      supportsBetaflightConfig: false, supportsGpsConfig: false, supportsRateProfiles: false, supportsAdjustments: false,
      manualControlHz: 0, parameterCount: 0,
    }
  }
  getFirmwareHandler(): FirmwareHandler | null { return this.firmwareHandler }
  getCommandQueueSnapshot() { return { pendingCount: this.commandQueue.pendingCount, entries: this.commandQueue.getSnapshot() } }

  private sendCommandLong(cmd: number, p: [number, number, number, number, number, number, number], timeout?: number): Promise<CommandResult> {
    if (!this.transport?.isConnected) return Promise.resolve({ success: false, resultCode: -1, message: 'Not connected' })
    return this.commandQueue.sendCommand(cmd, p, (d) => this.transport!.send(d), this.targetSysId, this.targetCompId, this.sysId, this.compId, timeout)
  }
}
