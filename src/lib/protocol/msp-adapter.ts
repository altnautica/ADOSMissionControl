/**
 * MSP (MultiWii Serial Protocol) adapter for Altnautica Command GCS.
 *
 * Thin composition class that implements `DroneProtocol` by delegating to:
 * - msp-adapter-telemetry.ts (telemetry dispatch)
 * - msp-adapter-commands.ts (commands)
 * - msp-adapter-params.ts (virtual parameter system)
 * - mavlink-adapter-callbacks.ts (shared callback store)
 *
 * @module protocol/msp-adapter
 */

import type {
  DroneProtocol, Transport, VehicleInfo, CommandResult, ParameterValue,
  FirmwareHandler, ProtocolCapabilities, UnifiedFlightMode,
  MissionItem, LogEntry, LogDownloadProgressCallback,
} from './types'
import { MspParser } from './msp/msp-parser'
import { MspSerialQueue } from './msp/msp-serial-queue'
import { MspTelemetryPoller } from './msp/msp-telemetry-poller'
import { MSP } from './msp/msp-constants'
import { buildBoxMap, parseModeRanges } from './msp/msp-mode-map'
import type { ModeRange } from './msp/msp-mode-map'
import { betaflightHandler } from './firmware/betaflight'
import { inavHandler } from './firmware/inav'
import { createCallbackStore, bindCallbackMethods } from './mavlink-adapter-callbacks'
import { dispatchMspTelemetry } from './msp-adapter-telemetry'
import * as cmds from './msp-adapter-commands'
import * as prm from './msp-adapter-params'

function u8(buf: Uint8Array, offset: number): number { return buf[offset] }

export class MSPAdapter implements DroneProtocol {
  readonly protocolName = 'msp'

  private parser: MspParser = new MspParser()
  private queue: MspSerialQueue | null = null
  private poller: MspTelemetryPoller | null = null
  private transport: Transport | null = null
  private firmwareHandler: FirmwareHandler | null = null
  private vehicleInfo: VehicleInfo | null = null
  private _connected = false
  private inCliMode = false
  private boxIds: number[] = []
  private modeRanges: ModeRange[] = []
  private paramCache: Map<number, Uint8Array> = new Map()
  private paramNameCache: string[] = []
  private cbs = createCallbackStore()
  private cbm = bindCallbackMethods(this.cbs)
  private dataHandler: ((data: Uint8Array) => void) | null = null
  private closeHandler: (() => void) | null = null

  get isConnected(): boolean { return this._connected }

  // ── Context helpers ─────────────────────────────────────────
  private get cmdCtx(): cmds.MspCommandContext { return { queue: this.queue, modeRanges: this.modeRanges } }
  private get prmCtx(): prm.MspParamContext { return { queue: this.queue, paramCache: this.paramCache, paramNameCache: this.paramNameCache, parameterCallbacks: this.cbs.parameterCallbacks } }

  // ── Connection ──────────────────────────────────────────────
  async connect(transport: Transport): Promise<VehicleInfo> {
    this.transport = transport
    this.dataHandler = (data: Uint8Array) => this.parser.feed(data)
    this.closeHandler = () => this.handleDisconnect()
    transport.on('data', this.dataHandler)
    transport.on('close', this.closeHandler as (data: void) => void)

    this.queue = new MspSerialQueue(transport.send.bind(transport), this.parser, 1000, 2)

    const apiVersionFrame = await this.queue.send(MSP.MSP_API_VERSION)
    const apiVersionMajor = u8(apiVersionFrame.payload, 1)
    const apiVersionMinor = u8(apiVersionFrame.payload, 2)

    const variantFrame = await this.queue.send(MSP.MSP_FC_VARIANT)
    const variantStr = String.fromCharCode(...variantFrame.payload)

    const versionFrame = await this.queue.send(MSP.MSP_FC_VERSION)
    const vP = versionFrame.payload
    const firmwareVersionString = `${variantStr} ${u8(vP, 0)}.${u8(vP, 1)}.${u8(vP, 2)} (MSP API ${apiVersionMajor}.${apiVersionMinor})`

    await this.queue.send(MSP.MSP_BOARD_INFO)

    const boxNamesFrame = await this.queue.send(MSP.MSP_BOXNAMES)
    const boxNames = String.fromCharCode(...boxNamesFrame.payload).split(';').filter(n => n.length > 0)

    const boxIdsFrame = await this.queue.send(MSP.MSP_BOXIDS)
    this.boxIds = Array.from(boxIdsFrame.payload)
    buildBoxMap(boxNames, this.boxIds)

    try {
      const modeRangesFrame = await this.queue.send(MSP.MSP_MODE_RANGES)
      this.modeRanges = parseModeRanges(modeRangesFrame.payload)
    } catch { this.modeRanges = [] }

    const isBetaflight = variantStr.trim() === 'BTFL'
    const isInav = variantStr.trim() === 'INAV'
    this.firmwareHandler = isInav ? inavHandler : betaflightHandler

    const info: VehicleInfo = {
      firmwareType: isBetaflight ? 'betaflight' : isInav ? 'inav' : 'unknown',
      vehicleClass: 'copter', firmwareVersionString,
      systemId: 0, componentId: 0, autopilotType: 0, vehicleType: 0,
    }
    this.vehicleInfo = info

    this.poller = new MspTelemetryPoller(this.queue, (command, payload) =>
      dispatchMspTelemetry(command, payload, this.cbs, this.vehicleInfo, this.boxIds))
    this.poller.start()
    this._connected = true
    return info
  }

  async disconnect(): Promise<void> {
    this.handleDisconnect()
    if (this.transport?.isConnected) await this.transport.disconnect()
  }

  private handleDisconnect(): void {
    if (!this._connected && !this.poller) return
    this._connected = false
    if (this.poller) { this.poller.stop(); this.poller = null }
    if (this.queue) { this.queue.destroy(); this.queue = null }
    this.parser.reset(); this.paramCache.clear(); this.paramNameCache = []; this.inCliMode = false
    if (this.transport && this.dataHandler) {
      this.transport.off('data', this.dataHandler)
      this.transport.off('close', this.closeHandler as (data: void) => void)
    }
    this.transport = null
  }

  // ── Commands ────────────────────────────────────────────────
  async arm() { return cmds.mspArm(this.cmdCtx) }
  async disarm() { return cmds.mspDisarm(this.cmdCtx) }
  async setFlightMode(m: UnifiedFlightMode) { return cmds.mspSetFlightMode(this.cmdCtx, m) }
  sendManualControl(r: number, p: number, t: number, y: number, _b: number) { cmds.mspSendManualControl(this.cmdCtx, r, p, t, y) }
  async motorTest(m: number, t: number, _d: number) { return cmds.mspMotorTest(this.cmdCtx, m, t) }
  async reboot() { return cmds.mspReboot(this.cmdCtx) }
  async rebootToBootloader() { return cmds.mspRebootToBootloader(this.cmdCtx) }
  async startCalibration(type: 'accel'|'gyro'|'compass'|'level'|'airspeed'|'baro'|'rc'|'esc'|'compassmot') { return cmds.mspStartCalibration(this.cmdCtx, type) }
  async commitParamsToFlash() { return cmds.mspCommitParamsToFlash(this.cmdCtx) }
  async killSwitch() { return cmds.mspKillSwitch(this.cmdCtx) }
  async doPreArmCheck() { return cmds.mspDoPreArmCheck(this.cmdCtx) }
  async returnToLaunch() { return cmds.mspReturnToLaunch() }
  async land() { return cmds.mspLand() }
  async takeoff(_alt: number) { return cmds.mspTakeoff() }
  async guidedGoto(_lat: number, _lon: number, _alt: number) { return cmds.mspGuidedGoto() }
  async pauseMission() { return cmds.mspPauseMission() }
  async resumeMission() { return cmds.mspResumeMission() }
  async clearMission() { return cmds.mspClearMission() }
  async setHome(_uc: boolean) { return cmds.mspSetHome() }
  async changeSpeed(_st: number, _sp: number) { return cmds.mspChangeSpeed() }
  async setYaw(_a: number, _s: number, _d: number, _r: boolean) { return cmds.mspSetYaw() }
  async setGeoFenceEnabled(_e: boolean) { return cmds.mspSetGeoFenceEnabled() }
  async setServo(_n: number, _p: number) { return cmds.mspSetServo() }
  async cameraTrigger() { return cmds.mspCameraTrigger() }
  async setGimbalAngle(_p: number, _r: number, _y: number) { return cmds.mspSetGimbalAngle() }
  async uploadMission(_items: MissionItem[]) { return cmds.mspUploadMission() }
  async downloadMission() { return cmds.mspDownloadMission() }
  async setCurrentMissionItem(_seq: number) { return cmds.mspSetCurrentMissionItem() }
  async resetParametersToDefault() { return cmds.mspResetParametersToDefault() }
  async getLogList() { return cmds.mspGetLogList() }
  async downloadLog(id: number, onProgress?: LogDownloadProgressCallback) { return cmds.mspDownloadLog(id, onProgress) }
  async eraseAllLogs() { return cmds.mspEraseAllLogs() }
  cancelLogDownload(): void { /* no-op */ }

  // ── Parameters ──────────────────────────────────────────────
  async getAllParameters() { const c = this.prmCtx; const r = await prm.mspGetAllParameters(c); this.paramNameCache = c.paramNameCache; return r }
  async getParameter(name: string) { return prm.mspGetParameter(this.prmCtx, name) }
  async setParameter(name: string, value: number, _type?: number) { return prm.mspSetParameter(this.prmCtx, name, value) }
  getCachedParameterNames(): string[] { return this.paramNameCache }

  // ── Serial Passthrough ──────────────────────────────────────
  sendSerialData(text: string): void {
    if (!this.transport) return
    if (!this.inCliMode) { this.transport.send(new TextEncoder().encode('#\n')); this.inCliMode = true }
    this.transport.send(new TextEncoder().encode(text))
  }

  // ── Telemetry Subscriptions ─────────────────────────────────
  onSerialData = (cb: import('./types').SerialDataCallback): (() => void) => {
    this.cbs.serialDataCallbacks.push(cb)
    this.parser.onCliData((text) => { cb({ device: 0, data: new TextEncoder().encode(text) }) })
    return () => { this.cbs.serialDataCallbacks = this.cbs.serialDataCallbacks.filter(c => c !== cb) }
  }
  onAttitude = this.cbm.onAttitude; onPosition = this.cbm.onPosition; onBattery = this.cbm.onBattery
  onGps = this.cbm.onGps; onVfr = this.cbm.onVfr; onRc = this.cbm.onRc
  onStatusText = this.cbm.onStatusText; onHeartbeat = this.cbm.onHeartbeat
  onParameter = this.cbm.onParameter
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

  // ── Info ────────────────────────────────────────────────────
  getVehicleInfo(): VehicleInfo | null { return this.vehicleInfo }
  getCapabilities(): ProtocolCapabilities {
    return this.firmwareHandler?.getCapabilities() ?? {
      supportsArming: false, supportsFlightModes: false, supportsMissionUpload: false,
      supportsMissionDownload: false, supportsManualControl: false, supportsParameters: false,
      supportsCalibration: false, supportsSerialPassthrough: false, supportsMotorTest: false,
      supportsGeoFence: false, supportsRally: false, supportsLogDownload: false,
      supportsOsd: false, supportsPidTuning: false, supportsPorts: false,
      supportsFailsafe: false, supportsPowerConfig: false, supportsReceiver: false,
      supportsFirmwareFlash: false, supportsCliShell: false, supportsMavlinkInspector: false,
      supportsGimbal: false, supportsCamera: false, supportsLed: false,
      supportsBattery2: false, supportsRangefinder: false, supportsOpticalFlow: false,
      supportsObstacleAvoidance: false, supportsDebugValues: false,
      supportsCanFrame: false, supportsAuxModes: false, supportsVtx: false, supportsBlackbox: false,
      supportsBetaflightConfig: false, supportsGpsConfig: false,
      supportsRateProfiles: false, supportsAdjustments: false,
      manualControlHz: 50, parameterCount: 0,
    }
  }
  getFirmwareHandler(): FirmwareHandler | null { return this.firmwareHandler }

  // MSP doesn't support these methods
  async sendCommand(_id: number, _p: number[]): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  confirmAccelCalPos(_pos: number): void { /* no-op */ }
  async acceptCompassCal(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async cancelCompassCal(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async cancelCalibration(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async startGnssMagCal(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async startEscCalibration(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async startCompassMotCal(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  sendPositionTarget(): void { /* no-op */ }
  sendAttitudeTarget(): void { /* no-op */ }
  async enableFence(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async doLandStart(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async controlVideo(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async setRelay(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async startRxPair(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async requestMessage(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async setMessageInterval(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async setGimbalMode(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async uploadFence(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async downloadFence(): Promise<Array<{ idx: number; lat: number; lon: number }>> { return [] }
  async uploadRallyPoints(): Promise<CommandResult> { return { success: false, resultCode: -1, message: 'Not supported by MSP firmware' } }
  async downloadRallyPoints(): Promise<Array<{ lat: number; lon: number; alt: number }>> { return [] }
  getCommandQueueSnapshot() { return { pendingCount: 0, entries: [] } }
}
