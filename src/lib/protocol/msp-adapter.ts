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
  MissionItem, LogEntry, LogDownloadProgressCallback, SettingsCapability,
  CliSettingsCapability,
} from './types'
import { MspParser } from './msp/msp-parser'
import { MspSerialQueue } from './msp/msp-serial-queue'
import { MspTelemetryPoller } from './msp/msp-telemetry-poller'
import { MSP, MSP2, FEATURE_FLAG } from './msp/msp-constants'
import { buildBoxMap, parseModeRanges } from './msp/msp-mode-map'
import { MspRcOverride } from './msp/msp-rc-override'
import type { ModeRange } from './msp/msp-mode-map'
import { betaflightHandler } from './firmware/betaflight'
import { inavHandler } from './firmware/inav'
import { createCallbackStore, bindCallbackMethods } from './mavlink-adapter-callbacks'
import { dispatchMspTelemetry } from './msp-adapter-telemetry'
import * as cmds from './msp-adapter-commands'
import * as prm from './msp-adapter-params'
import * as inav from './msp-adapter-inav'
import { SettingsClient } from './msp/settings'
import { BfCliSession } from './msp/bf-cli'
import { makeCliSettingsCapability } from './msp/bf-cli-settings'
import { decodeMspSerialConfig, decodeMspSerialConfig2, type MspSerialPort } from './msp/decoders/config/serial'
import { decodeMspRxConfig, decodeMspRxMap, type BfRxConfig } from './msp/decoders/config/rx'
import { encodeMspSetSerialConfig, encodeMspSetSerialConfig2, encodeMspSendDshotCommand, encodeMspSetRxConfig, encodeMspSetRxMap } from './msp/encoders/config'
import { decodeMspOsdConfig, type MspOsdConfig } from './msp/decoders/config/osd'
import { decodeMspLedStripConfig, decodeMspLedColors, decodeMspLedStripModeColors, type HsvColor, type BfLedModeColor } from './msp/decoders/config/led'
import { decodeMspDisplayPort, type DisplayPortOp } from './msp/decoders/config/displayport'
import { encodeMspSetOsdConfig, encodeMspOsdCharWrite, encodeMspSetLedStripConfigEntry, encodeMspSetLedColors, encodeMspSetLedStripModeColor } from './msp/encoders/osd-led'
import {
  getFlashSummary,
  downloadBlackboxLog,
  eraseBlackboxFlash,
  type BlackboxDownloadProgress,
} from './msp/msp-blackbox'
import type {
  INavSafehome,
  INavGeozone,
  INavGeozoneVertex,
  INavBatteryConfig,
  INavMixer,
  INavServoConfig,
  INavMcBraking,
  INavRateDynamics,
  INavTimerOutputModeEntry,
  INavOutputMappingExt2Entry,
  INavTempSensorConfigEntry,
  MotorMixerRule,
  INavServoMixerRule,
} from './msp/msp-decoders-inav'

function u8(buf: Uint8Array, offset: number): number { return buf[offset] }

/**
 * Wrap a connected `SettingsClient` as the firmware-agnostic
 * `SettingsCapability` exposed on `DroneProtocol.settings`.
 */
function makeSettingsCapability(client: SettingsClient): SettingsCapability {
  return {
    getSetting: (name) => client.get(name),
    setSetting: async (name, value) => {
      try {
        await client.set(name, value)
        return { success: true, resultCode: 0, message: 'OK' }
      } catch (err) {
        return { success: false, resultCode: -1, message: err instanceof Error ? err.message : String(err) }
      }
    },
    getSettingInfo: (name) => client.getInfo(name),
    enumerate: () => client.enumerateAllSettings(),
  }
}

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
  /** True only when the FC's receiver provider is MSP; RC override is inert otherwise. */
  private rxMspEnabled = false
  private rcOverride: MspRcOverride | null = null
  private paramCache: Map<number, Uint8Array> = new Map()
  private paramNameCache: string[] = []
  private settingsClient: SettingsClient | null = null
  private settingsCapability: SettingsCapability | null = null
  private bfCli: BfCliSession | null = null
  private cliSettingsCapability: CliSettingsCapability | null = null
  private cbs = createCallbackStore()
  private cbm = bindCallbackMethods(this.cbs)
  private dataHandler: ((data: Uint8Array) => void) | null = null
  private closeHandler: (() => void) | null = null

  get isConnected(): boolean { return this._connected }

  // ── Context helpers ─────────────────────────────────────────
  private get cmdCtx(): cmds.MspCommandContext { return { queue: this.queue, modeRanges: this.modeRanges, rc: this.rcOverride, firmwareType: this.vehicleInfo?.firmwareType } }
  private get prmCtx(): prm.MspParamContext { return { queue: this.queue, paramCache: this.paramCache, paramNameCache: this.paramNameCache, parameterCallbacks: this.cbs.parameterCallbacks, settingsClient: this.settingsClient, isInav: this.vehicleInfo?.firmwareType === 'inav' } }

  // ── Connection ──────────────────────────────────────────────
  async connect(transport: Transport): Promise<VehicleInfo> {
    this.transport = transport
    // While a Betaflight CLI session is active the FC speaks only plain-ASCII
    // CLI (not MSP), so route inbound bytes to the CLI session instead of the
    // MSP parser, which would drop them.
    this.dataHandler = (data: Uint8Array) => {
      if (this.bfCli?.isActive) this.bfCli.feed(data)
      else this.parser.feed(data)
    }
    this.closeHandler = () => this.handleDisconnect()
    transport.on('data', this.dataHandler)
    transport.on('close', this.closeHandler as (data: void) => void)

    this.queue = new MspSerialQueue(transport.send.bind(transport), this.parser, 1000, 2)
    this.settingsClient = new SettingsClient(this.queue)
    this.settingsCapability = makeSettingsCapability(this.settingsClient)

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

    // MSP_SET_RAW_RC only reaches rcData[] when the receiver provider is MSP.
    // With any other receiver the FC parses the frame and discards it, so an
    // override that reported success would be describing nothing. A feature
    // word we could not read is not evidence either way, so it reads as off.
    try {
      const featureFrame = await this.queue.send(MSP.MSP_FEATURE_CONFIG)
      const fp = featureFrame.payload
      const features = fp.length >= 4
        ? ((fp[0] | (fp[1] << 8) | (fp[2] << 16) | (fp[3] << 24)) >>> 0)
        : 0
      this.rxMspEnabled = ((features >>> FEATURE_FLAG.RX_MSP) & 1) === 1
    } catch { this.rxMspEnabled = false }

    const rcQueue = this.queue
    this.rcOverride = new MspRcOverride({
      send: (payload) => rcQueue.sendNoReply(MSP.MSP_SET_RAW_RC, payload),
      modeRanges: this.modeRanges,
      rxMspEnabled: this.rxMspEnabled,
    })

    const isBetaflight = variantStr.trim() === 'BTFL'
    const isInav = variantStr.trim() === 'INAV'
    this.firmwareHandler = isInav ? inavHandler : betaflightHandler
    if (isBetaflight) {
      // Betaflight settings live only behind the CLI. The session pauses MSP
      // polling while active and drives the raw-byte tap set up above.
      this.bfCli = new BfCliSession({
        send: (bytes) => this.transport?.send(bytes),
        setActive: (active) => { this.inCliMode = active; if (active) this.poller?.stop(); else this.poller?.start() },
      })
      this.cliSettingsCapability = makeCliSettingsCapability(this.bfCli)
    }

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
    if (this.rcOverride) { this.rcOverride.destroy(); this.rcOverride = null }
    this.rxMspEnabled = false
    if (this.poller) { this.poller.stop(); this.poller = null }
    if (this.queue) { this.queue.destroy(); this.queue = null }
    this.parser.reset(); this.paramCache.clear(); this.paramNameCache = []; this.inCliMode = false; this.settingsClient = null; this.settingsCapability = null; this.bfCli = null; this.cliSettingsCapability = null
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
  async returnToLaunch() { return cmds.mspReturnToLaunch(this.cmdCtx) }
  async land() { return cmds.mspLand(this.cmdCtx) }
  async takeoff(alt: number) { return cmds.mspTakeoff(this.cmdCtx, alt) }
  async guidedGoto(lat: number, lon: number, alt: number) { return cmds.mspGuidedGoto(this.cmdCtx, lat, lon, alt) }
  async pauseMission() { return cmds.mspPauseMission(this.cmdCtx) }
  async resumeMission() { return cmds.mspResumeMission(this.cmdCtx) }
  async clearMission() { return cmds.mspClearMission() }
  async setHome(_uc: boolean) { return cmds.mspSetHome() }
  async changeSpeed(_st: number, _sp: number) { return cmds.mspChangeSpeed() }
  async setYaw(_a: number, _s: number, _d: number, _r: boolean) { return cmds.mspSetYaw() }
  async setGeoFenceEnabled(_e: boolean) { return cmds.mspSetGeoFenceEnabled() }
  async setServo(_n: number, _p: number) { return cmds.mspSetServo() }
  async cameraTrigger() { return cmds.mspCameraTrigger() }
  async setGimbalAngle(_p: number, _r: number, _y: number) { return cmds.mspSetGimbalAngle() }
  async uploadMission(items: MissionItem[]) {
    if (this.vehicleInfo?.firmwareType === 'inav') {
      return inav.inavUploadMission(this.queue, items)
    }
    return cmds.mspUploadMission()
  }
  async downloadMission(): Promise<MissionItem[]> {
    if (this.vehicleInfo?.firmwareType === 'inav') {
      return inav.inavDownloadMission(this.queue)
    }
    return cmds.mspDownloadMission()
  }
  async setCurrentMissionItem(_seq: number) { return cmds.mspSetCurrentMissionItem() }

  // MSP firmwares do not implement the MAVLink EKF source-set command. Resolve
  // with a typed rejection so callers can render the right UX.
  async setEkfSourceSet(sourceSet: 1 | 2 | 3): Promise<{ ok: true } | { ok: false; reason: 'px4-not-supported' | 'no-ack' | 'rejected' }> {
    if (sourceSet !== 1 && sourceSet !== 2 && sourceSet !== 3) {
      throw new TypeError(`setEkfSourceSet: sourceSet must be 1, 2, or 3 (received ${String(sourceSet)})`)
    }
    return { ok: false, reason: 'rejected' }
  }

  // ── iNav-specific methods ────────────────────────────────────
  async downloadSafehomes(): Promise<INavSafehome[]> {
    return inav.inavDownloadSafehomes(this.queue)
  }

  async uploadSafehomes(safehomes: INavSafehome[]): Promise<CommandResult> {
    return inav.inavUploadSafehomes(this.queue, safehomes)
  }

  async downloadGeozones(): Promise<{ zones: INavGeozone[]; vertices: INavGeozoneVertex[] }> {
    return inav.inavDownloadGeozones(this.queue)
  }

  async uploadGeozones(zones: INavGeozone[], vertices: INavGeozoneVertex[]): Promise<CommandResult> {
    return inav.inavUploadGeozones(this.queue, zones, vertices)
  }

  async getBatteryConfig(): Promise<INavBatteryConfig> { return inav.inavGetBatteryConfig(this.queue) }
  async setBatteryConfig(cfg: INavBatteryConfig): Promise<CommandResult> { return inav.inavSetBatteryConfig(this.queue, cfg) }
  async selectBatteryProfile(idx: number): Promise<CommandResult> { return inav.inavSelectBatteryProfile(this.queue, idx) }
  async getMixerConfig(): Promise<INavMixer> { return inav.inavGetMixerConfig(this.queue) }
  async selectMixerProfile(idx: number): Promise<CommandResult> { return inav.inavSelectMixerProfile(this.queue, idx) }
  async getOutputMapping(): Promise<INavOutputMappingExt2Entry[]> { return inav.inavGetOutputMapping(this.queue) }
  async getTimerOutputModes(): Promise<INavTimerOutputModeEntry[]> { return inav.inavGetTimerOutputModes(this.queue) }
  async setTimerOutputMode(entries: INavTimerOutputModeEntry[]): Promise<CommandResult> { return inav.inavSetTimerOutputModes(this.queue, entries) }
  async getServoConfigs(): Promise<INavServoConfig[]> { return inav.inavGetServoConfigs(this.queue) }
  async setServoConfig(idx: number, cfg: INavServoConfig): Promise<CommandResult> { return inav.inavSetServoConfig(this.queue, idx, cfg) }
  async getTempSensorConfigs(): Promise<INavTempSensorConfigEntry[]> { return inav.inavGetTempSensorConfigs(this.queue) }
  async getMcBraking(): Promise<INavMcBraking> { return inav.inavGetMcBraking(this.queue) }
  async setMcBraking(b: INavMcBraking): Promise<CommandResult> { return inav.inavSetMcBraking(this.queue, b) }
  async getRateDynamics(): Promise<INavRateDynamics> { return inav.inavGetRateDynamics(this.queue) }
  async setRateDynamics(r: INavRateDynamics): Promise<CommandResult> { return inav.inavSetRateDynamics(this.queue, r) }
  async getEzTune() { return inav.inavGetEzTune(this.queue) }
  async setEzTune(cfg: Parameters<typeof inav.inavSetEzTune>[1]) { return inav.inavSetEzTune(this.queue, cfg) }
  async getFwApproach() { return inav.inavGetFwApproach(this.queue) }
  async setFwApproach(a: Parameters<typeof inav.inavSetFwApproach>[1]) { return inav.inavSetFwApproach(this.queue, a) }
  async getOsdLayoutsHeader() { return inav.inavGetOsdLayoutsHeader(this.queue) }
  async getOsdAlarms() { return inav.inavGetOsdAlarms(this.queue) }
  async setOsdAlarms(a: Parameters<typeof inav.inavSetOsdAlarms>[1]) { return inav.inavSetOsdAlarms(this.queue, a) }
  async getOsdPreferences() { return inav.inavGetOsdPreferences(this.queue) }
  async setOsdPreferences(p: Parameters<typeof inav.inavSetOsdPreferences>[1]) { return inav.inavSetOsdPreferences(this.queue, p) }
  async setCustomOsdElement(el: Parameters<typeof inav.inavSetCustomOsdElement>[1]) { return inav.inavSetCustomOsdElement(this.queue, el) }
  async downloadLogicConditions() { return inav.inavDownloadLogicConditions(this.queue) }
  async uploadLogicCondition(idx: number, rule: Parameters<typeof inav.inavUploadLogicCondition>[2]) { return inav.inavUploadLogicCondition(this.queue, idx, rule) }
  async downloadLogicConditionsStatus() { return inav.inavDownloadLogicConditionsStatus(this.queue) }
  async downloadGvarStatus() { return inav.inavDownloadGvarStatus(this.queue) }
  async setGvar(index: number, value: number) { return inav.inavSetGvar(this.queue, index, value) }
  async downloadProgrammingPids() { return inav.inavDownloadProgrammingPids(this.queue) }
  async uploadProgrammingPid(idx: number, rule: Parameters<typeof inav.inavUploadProgrammingPid>[2]) { return inav.inavUploadProgrammingPid(this.queue, idx, rule) }
  async downloadProgrammingPidStatus() { return inav.inavDownloadProgrammingPidStatus(this.queue) }
  async downloadMotorMixer(): Promise<MotorMixerRule[]> { return inav.inavDownloadMotorMixer(this.queue) }
  async uploadMotorMixer(rules: MotorMixerRule[]): Promise<void> { return inav.inavUploadMotorMixer(this.queue, rules) }
  async downloadServoMixer(): Promise<INavServoMixerRule[]> { return inav.inavDownloadServoMixer(this.queue) }
  async uploadServoMixer(rules: INavServoMixerRule[]): Promise<void> { return inav.inavUploadServoMixer(this.queue, rules) }

  async resetParametersToDefault() { return cmds.mspResetParametersToDefault() }
  async getLogList() { return cmds.mspGetLogList() }
  async downloadLog(id: number, onProgress?: LogDownloadProgressCallback) { return cmds.mspDownloadLog(id, onProgress) }
  async eraseAllLogs() { return cmds.mspEraseAllLogs() }
  cancelLogDownload(): void { /* no-op */ }
  // MSP has no MAVLink FTP transport. Reject explicitly rather than return
  // fabricated bytes so callers surface the real limitation.
  async downloadFileViaFtp(): Promise<Uint8Array> { throw new Error('MAVLink FTP is not available over MSP') }

  // ── Blackbox (onboard-flash logging) ─────────────────────────
  /** Read the onboard-flash summary (total/used bytes + ready state). */
  async getDataflashSummary(): Promise<{ totalSize: number; usedSize: number; ready: boolean }> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    const s = await getFlashSummary(this.queue)
    return { totalSize: s.totalSize, usedSize: s.usedSize, ready: s.ready }
  }

  /**
   * Download the raw blackbox log from onboard flash. Sizes the transfer from
   * the flash summary, then chunk-reads the used region via MSP_DATAFLASH_READ.
   * Returns the raw `.bbl` bytes with no decode (empty when the flash is not
   * ready or holds no data).
   */
  async downloadBlackbox(onProgress?: (p: BlackboxDownloadProgress) => void): Promise<Uint8Array> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    const summary = await getFlashSummary(this.queue)
    if (!summary.ready || summary.usedSize <= 0) return new Uint8Array(0)
    return downloadBlackboxLog(this.queue, 0, summary.usedSize, onProgress)
  }

  /** Erase all onboard-flash blackbox logs (polls until the flash reports empty). */
  async eraseDataflash(): Promise<void> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    await eraseBlackboxFlash(this.queue)
  }

  // ── Serial ports (MSP2_COMMON_SERIAL_CONFIG, legacy MSP_CF_SERIAL_CONFIG) ──
  /** True once a read used the 32-bit MSP2 serial config (function bits > 15). */
  private _serialUsesV2: boolean | null = null

  /** Read the per-UART serial-port configuration (function mask + baud indices). */
  async getSerialConfig(): Promise<MspSerialPort[]> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    // Prefer the 32-bit MSP2 config; fall back to the legacy U16 config.
    try {
      const frame = await this.queue.send(MSP2.MSP2_COMMON_SERIAL_CONFIG)
      const p = frame.payload
      const ports = decodeMspSerialConfig2(new DataView(p.buffer, p.byteOffset, p.byteLength)).ports
      this._serialUsesV2 = true
      return ports
    } catch {
      const frame = await this.queue.send(MSP.MSP_CF_SERIAL_CONFIG)
      const p = frame.payload
      this._serialUsesV2 = false
      return decodeMspSerialConfig(new DataView(p.buffer, p.byteOffset, p.byteLength)).ports
    }
  }

  /** Whether the current serial config carries the 32-bit (MSP2) function mask. */
  serialConfigExtended(): boolean {
    return this._serialUsesV2 === true
  }

  /** Write the per-UART serial-port configuration (matching the read transport). */
  async setSerialConfig(ports: MspSerialPort[]): Promise<CommandResult> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    if (this._serialUsesV2 === false) {
      await this.queue.send(MSP.MSP_SET_CF_SERIAL_CONFIG, encodeMspSetSerialConfig(ports))
    } else {
      await this.queue.send(MSP2.MSP2_COMMON_SET_SERIAL_CONFIG, encodeMspSetSerialConfig2(ports))
    }
    return { success: true, resultCode: 0, message: 'OK' }
  }

  /**
   * Send a DShot special command (beacon, spin direction, 3D mode, save).
   * The FC only acts on these while DISARMED and silently ignores them when
   * armed; fire-and-forget (no reply).
   */
  async sendDshotCommand(commandType: number, motorIndex: number, commands: number[]): Promise<CommandResult> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    this.queue.sendNoReply(MSP2.MSP2_SEND_DSHOT_COMMAND, encodeMspSendDshotCommand(commandType, motorIndex, commands))
    return { success: true, resultCode: 0, message: 'OK' }
  }

  // ── OSD (Betaflight MSP_OSD_CONFIG + character font) ─────────
  /** Read the OSD config (video system, alarms, and per-element positions). */
  async getOsdConfig(): Promise<MspOsdConfig> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    const frame = await this.queue.send(MSP.MSP_OSD_CONFIG)
    const p = frame.payload
    return decodeMspOsdConfig(new DataView(p.buffer, p.byteOffset, p.byteLength))
  }

  /** Write the OSD layout: optionally the video system, then each element position. */
  async writeOsdLayout(items: Array<{ index: number; position: number }>, videoSystem?: number): Promise<CommandResult> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    if (videoSystem !== undefined) await this.queue.send(MSP.MSP_SET_OSD_CONFIG, encodeMspSetOsdConfig(0xff, videoSystem))
    for (const it of items) await this.queue.send(MSP.MSP_SET_OSD_CONFIG, encodeMspSetOsdConfig(it.index, it.position))
    return { success: true, resultCode: 0, message: 'OK' }
  }

  /** Upload a character font: one MSP_OSD_CHAR_WRITE per glyph. */
  async uploadOsdFont(glyphs: Uint8Array[], onProgress?: (done: number, total: number) => void): Promise<CommandResult> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    for (let i = 0; i < glyphs.length; i++) {
      await this.queue.send(MSP.MSP_OSD_CHAR_WRITE, encodeMspOsdCharWrite(i, glyphs[i]))
      onProgress?.(i + 1, glyphs.length)
    }
    return { success: true, resultCode: 0, message: `Wrote ${glyphs.length} glyphs` }
  }

  // ── LED strip (Betaflight MSP_LED_STRIP_CONFIG) ──────────────
  /** Read the per-LED packed configs. */
  async getLedStripConfig(): Promise<number[]> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    const frame = await this.queue.send(MSP.MSP_LED_STRIP_CONFIG)
    const p = frame.payload
    return decodeMspLedStripConfig(new DataView(p.buffer, p.byteOffset, p.byteLength)).leds
  }

  /** Write the per-LED packed configs (one MSP write per LED, by index). */
  async setLedStripConfig(leds: number[]): Promise<CommandResult> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    for (let i = 0; i < leds.length; i++) {
      await this.queue.send(MSP.MSP_SET_LED_STRIP_CONFIG, encodeMspSetLedStripConfigEntry(i, leds[i]))
    }
    return { success: true, resultCode: 0, message: 'OK' }
  }

  /** Read the 16-entry configurable HSV colour palette (MSP_LED_COLORS 46). */
  async getLedColors(): Promise<HsvColor[]> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    const frame = await this.queue.send(MSP.MSP_LED_COLORS)
    const p = frame.payload
    return decodeMspLedColors(new DataView(p.buffer, p.byteOffset, p.byteLength))
  }

  /** Write the full HSV colour palette (MSP_SET_LED_COLORS 47). */
  async setLedColors(colors: HsvColor[]): Promise<CommandResult> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    await this.queue.send(MSP.MSP_SET_LED_COLORS, encodeMspSetLedColors(colors))
    return { success: true, resultCode: 0, message: 'OK' }
  }

  /** Read the mode/special/aux colour assignments (MSP_LED_STRIP_MODECOLOR 127). */
  async getLedStripModeColors(): Promise<BfLedModeColor[]> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    const frame = await this.queue.send(MSP.MSP_LED_STRIP_MODECOLOR)
    const p = frame.payload
    return decodeMspLedStripModeColors(new DataView(p.buffer, p.byteOffset, p.byteLength))
  }

  /** Set one mode colour (MSP_SET_LED_STRIP_MODECOLOR 221). */
  async setLedStripModeColor(mode: number, fun: number, color: number): Promise<CommandResult> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    await this.queue.send(MSP.MSP_SET_LED_STRIP_MODECOLOR, encodeMspSetLedStripModeColor(mode, fun, color))
    return { success: true, resultCode: 0, message: 'OK' }
  }

  /**
   * Subscribe to MSP DisplayPort (182) OSD frames the FC pushes. Fires only if
   * the FC is configured to output OSD over MSP DisplayPort on this connection.
   */
  onDisplayPort(cb: (op: DisplayPortOp) => void): () => void {
    if (!this.queue) return () => {}
    return this.queue.onUnsolicited((frame) => {
      if (frame.command === MSP.MSP_DISPLAYPORT) {
        const p = frame.payload
        cb(decodeMspDisplayPort(new DataView(p.buffer, p.byteOffset, p.byteLength)))
      }
    })
  }

  // ── Receiver (Betaflight MSP_RX_CONFIG / MSP_RX_MAP) ─────────
  /** Read the receiver config (leading fields + raw payload for round-trip). */
  async getRxConfig(): Promise<BfRxConfig> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    const frame = await this.queue.send(MSP.MSP_RX_CONFIG)
    const p = frame.payload
    return decodeMspRxConfig(new DataView(p.buffer, p.byteOffset, p.byteLength))
  }

  /** Write the receiver config (echoes the raw payload with edited fields patched). */
  async setRxConfig(cfg: BfRxConfig): Promise<CommandResult> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    await this.queue.send(MSP.MSP_SET_RX_CONFIG, encodeMspSetRxConfig(cfg))
    return { success: true, resultCode: 0, message: 'OK' }
  }

  /** Read the RC channel map. */
  async getRxMap(): Promise<number[]> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    const frame = await this.queue.send(MSP.MSP_RX_MAP)
    return decodeMspRxMap(frame.payload)
  }

  /** Write the RC channel map. */
  async setRxMap(map: number[]): Promise<CommandResult> {
    if (!this.queue) throw new Error('Not connected to flight controller')
    await this.queue.send(MSP.MSP_SET_RX_MAP, encodeMspSetRxMap(map))
    return { success: true, resultCode: 0, message: 'OK' }
  }

  // ── Parameters ──────────────────────────────────────────────
  async getAllParameters() { const c = this.prmCtx; const r = await prm.mspGetAllParameters(c); this.paramNameCache = c.paramNameCache; return r }
  async getParameter(name: string) { return prm.mspGetParameter(this.prmCtx, name) }
  async setParameter(name: string, value: number, _type?: number) { return prm.mspSetParameter(this.prmCtx, name, value) }
  getCachedParameterNames(): string[] { return this.paramNameCache }

  // ── iNav name-based settings ────────────────────────────────
  /**
   * Name-indexed settings surface (`DroneProtocol.settings`), backed by the
   * typed `SettingsClient`. Undefined until connected to an MSP firmware.
   */
  get settings(): SettingsCapability | undefined { return this.settingsCapability ?? undefined }

  /**
   * Text-CLI settings surface (`DroneProtocol.cliSettings`), backed by a
   * Betaflight CLI session. Undefined until connected to a Betaflight FC.
   */
  get cliSettings(): CliSettingsCapability | undefined { return this.cliSettingsCapability ?? undefined }

  // ── Serial Passthrough ──────────────────────────────────────
  sendSerialData(text: string): void {
    // Betaflight's CLI is plain ASCII the MSP parser drops, so drive it through
    // the interactive CLI session (which also appends the command newline).
    if (this.bfCli) { this.bfCli.sendInteractive(text); return }
    if (!this.transport) return
    if (!this.inCliMode) { this.transport.send(new TextEncoder().encode('#\n')); this.inCliMode = true }
    this.transport.send(new TextEncoder().encode(text))
  }

  // ── Telemetry Subscriptions ─────────────────────────────────
  onSerialData = (cb: import('./types').SerialDataCallback): (() => void) => {
    this.cbs.serialDataCallbacks.push(cb)
    if (this.bfCli) {
      // Betaflight: stream the raw CLI text (enters the CLI, pausing polling).
      this.bfCli.attachInteractive((text) => cb({ device: 0, data: new TextEncoder().encode(text) }))
      return () => { this.bfCli?.detachInteractive(); this.cbs.serialDataCallbacks = this.cbs.serialDataCallbacks.filter(c => c !== cb) }
    }
    this.parser.onCliData((text) => { cb({ device: 0, data: new TextEncoder().encode(text) }) })
    return () => { this.cbs.serialDataCallbacks = this.cbs.serialDataCallbacks.filter(c => c !== cb) }
  }
  onAttitude = this.cbm.onAttitude; onPosition = this.cbm.onPosition; onBattery = this.cbm.onBattery
  onGps = this.cbm.onGps; onVfr = this.cbm.onVfr; onRc = this.cbm.onRc
  onStatusText = this.cbm.onStatusText; onEvent = this.cbm.onEvent; onHeartbeat = this.cbm.onHeartbeat
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
    const base = this.firmwareHandler?.getCapabilities() ?? this.emptyCapabilities()
    // The firmware handler declares the rate its flight controller expects; it
    // cannot know whether this particular flight controller is configured to
    // read the frames at all. When the override is blocked or absent nothing
    // is transmitted, and reporting a rate would describe traffic that does
    // not exist.
    const sends = this.rcOverride !== null && this.rcOverride.blockedReason === null
    return sends ? base : { ...base, manualControlHz: 0 }
  }

  private emptyCapabilities(): ProtocolCapabilities {
    return {
      supportsArming: false, supportsFlightModes: false, supportsMissionUpload: false,
      supportsMissionDownload: false, supportsManualControl: false, supportsParameters: false,
      supportsCalibration: false, supportsSerialPassthrough: false, supportsMotorTest: false,
      supportsAutonomousNav: false, supportsGeoFence: false, supportsRally: false, supportsLogDownload: false,
      supportsOsd: false, supportsDisplayPort: false, supportsPidTuning: false, supportsPorts: false,
      supportsFailsafe: false, supportsPowerConfig: false, supportsReceiver: false,
      supportsFirmwareFlash: false, supportsCliShell: false, supportsMavlinkInspector: false,
      supportsGimbal: false, supportsCamera: false, supportsLed: false,
      supportsBattery2: false, supportsRangefinder: false, supportsOpticalFlow: false,
      supportsObstacleAvoidance: false, supportsDebugValues: false,
      supportsCanFrame: false, supportsAuxModes: false, supportsVtx: false, supportsBlackbox: false,
      supportsBetaflightConfig: false, supportsMspMotors: false, supportsGpsConfig: false, supportsEkfConfig: false, supportsStreamRates: false, supportsVtolConfig: false, supportsTecsConfig: false, supportsSubConfig: false, supportsPx4Tuning: false,
      supportsRateProfiles: false, supportsAdjustments: false,
      supportsMavlinkSigning: false,
      supportsMultiMission: false, supportsSafehome: false, supportsGeozone: false,
      supportsLogicConditions: false, supportsGlobalVariables: false, supportsProgrammingPid: false,
      supportsEzTune: false, supportsFwApproach: false, supportsCustomOsd: false,
      supportsMixerProfile: false, supportsBatteryProfile: false, supportsTempSensors: false,
      supportsServoMixer: false, supportsOutputMappingExt: false, supportsRateDynamics: false,
      supportsMcBraking: false, supportsSettings: false, supportsCliSettings: false,
      manualControlHz: 0, parameterCount: 0,
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
