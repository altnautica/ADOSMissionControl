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
import * as bf from './msp-adapter/bf-config'
import * as ranges from './msp-adapter/ranges'
import type { MspSerialPort } from './msp/decoders/config/serial'
import type { BfRxConfig } from './msp/decoders/config/rx'
import type { MspOsdConfig, MspOsdGeneralConfig } from './msp/decoders/config/osd'
import type { HsvColor, BfLedModeColor } from './msp/decoders/config/led'
import { decodeMspDisplayPort, type DisplayPortOp } from './msp/decoders/config/displayport'
import type { MspAdjustmentRange, MspModeBox, MspModeRange } from './msp/msp-decoders-status'
import { decodeMspBoardInfo } from './msp/msp-decoders-status'
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
  INavFwApproach,
} from './msp/msp-decoders-inav'
import { INAV_LIMITS } from './msp/decoders/inav/constants'

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
  /**
   * Last armed flag decoded from MSP_STATUS_EX. MSP has no separate arm query,
   * so this is the only arm state the link has, and a safety gate that needs
   * it (motor test) reads it from here rather than guessing.
   */
  private lastArmed = false
  private dataHandler: ((data: Uint8Array) => void) | null = null
  private closeHandler: (() => void) | null = null

  get isConnected(): boolean { return this._connected }

  // ── Context helpers ─────────────────────────────────────────
  private get cmdCtx(): cmds.MspCommandContext { return { queue: this.queue, modeRanges: this.modeRanges, rc: this.rcOverride, firmwareType: this.vehicleInfo?.firmwareType, isArmed: () => this.lastArmed } }
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

    const boardInfoFrame = await this.queue.send(MSP.MSP_BOARD_INFO)
    const boardInfo = decodeMspBoardInfo(new DataView(boardInfoFrame.payload.buffer, boardInfoFrame.payload.byteOffset, boardInfoFrame.payload.byteLength))

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
      gyroSampleRateHz: boardInfo.gyroSampleRateHz,
    }
    this.vehicleInfo = info

    // Retain the armed flag as it goes past: the motor-test gate needs it and
    // MSP offers no way to ask for it on demand.
    this.cbs.heartbeatCallbacks.push((hb) => { this.lastArmed = hb.armed })
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
    if (this.queue) { cmds.mspCancelMotorTest(this.queue); this.queue.destroy(); this.queue = null }
    this.parser.reset(); this.paramCache.clear(); this.paramNameCache = []; this.inCliMode = false; this.lastArmed = false; this.settingsClient = null; this.settingsCapability = null; this.bfCli = null; this.cliSettingsCapability = null
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
  async motorTest(m: number, t: number, d: number) { return cmds.mspMotorTest(this.cmdCtx, m, t, d) }
  async setMotorTestOutputs(t: readonly number[], d: number) { return cmds.mspSetMotorOutputs(this.cmdCtx, t, d) }
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

  /**
   * Run a config write, then MSP_EEPROM_WRITE. MSP config writes only change
   * the FC's RAM, so without the EEPROM write every change is lost at the
   * next power cycle. The result is a success only when both steps succeed.
   */
  private async persist(write: () => Promise<CommandResult>): Promise<CommandResult> {
    const result = await write()
    if (!result.success) return result
    const saved = await cmds.mspCommitParamsToFlash(this.cmdCtx)
    if (!saved.success) {
      return { success: false, resultCode: -1, message: `Written to the flight controller's RAM but not saved: ${saved.message}` }
    }
    return result
  }

  /** `persist` for uploads that report failure by throwing. */
  private async persistOrThrow(write: () => Promise<void>): Promise<void> {
    const result = await this.persist(async () => { await write(); return { success: true, resultCode: 0, message: 'OK' } })
    if (!result.success) throw new Error(result.message)
  }

  // ── iNav-specific methods ────────────────────────────────────
  async downloadSafehomes(): Promise<INavSafehome[]> { return inav.inavDownloadSafehomes(this.queue) }
  async uploadSafehomes(safehomes: INavSafehome[]): Promise<CommandResult> { return this.persist(() => inav.inavUploadSafehomes(this.queue, safehomes)) }
  async downloadGeozones(): Promise<{ zones: INavGeozone[]; vertices: INavGeozoneVertex[] }> { return inav.inavDownloadGeozones(this.queue) }
  async uploadGeozones(zones: INavGeozone[], vertices: INavGeozoneVertex[]): Promise<CommandResult> { return this.persist(() => inav.inavUploadGeozones(this.queue, zones, vertices)) }

  async getBatteryConfig(): Promise<INavBatteryConfig> { return inav.inavGetBatteryConfig(this.queue) }
  async setBatteryConfig(cfg: INavBatteryConfig): Promise<CommandResult> { return this.persist(() => inav.inavSetBatteryConfig(this.queue, cfg)) }
  // Profile selects are saved to EEPROM by the FC itself.
  async selectBatteryProfile(idx: number): Promise<CommandResult> { return inav.inavSelectBatteryProfile(this.queue, idx) }
  async getMixerConfig(): Promise<INavMixer> { return inav.inavGetMixerConfig(this.queue) }
  async selectMixerProfile(idx: number): Promise<CommandResult> { return inav.inavSelectMixerProfile(this.queue, idx) }
  async getOutputMapping(): Promise<INavOutputMappingExt2Entry[]> { return inav.inavGetOutputMapping(this.queue) }
  async getTimerOutputModes(): Promise<INavTimerOutputModeEntry[]> { return inav.inavGetTimerOutputModes(this.queue) }
  async setTimerOutputMode(entries: INavTimerOutputModeEntry[]): Promise<CommandResult> {
    return this.persist(async () => {
      for (const entry of entries) {
        const r = await inav.inavSetTimerOutputMode(this.queue, entry)
        if (!r.success) return r
      }
      return { success: true, resultCode: 0, message: `${entries.length} timer output modes saved` }
    })
  }
  async getServoConfigs(): Promise<INavServoConfig[]> { return inav.inavGetServoConfigs(this.queue) }
  async setServoConfigs(cfgs: INavServoConfig[]): Promise<CommandResult> {
    return this.persist(async () => {
      for (let i = 0; i < cfgs.length; i++) {
        const r = await inav.inavSetServoConfig(this.queue, i, cfgs[i])
        if (!r.success) return r
      }
      return { success: true, resultCode: 0, message: `${cfgs.length} servo configs saved` }
    })
  }
  async getTempSensorConfigs(): Promise<INavTempSensorConfigEntry[]> { return inav.inavGetTempSensorConfigs(this.queue) }
  async getMcBraking(): Promise<INavMcBraking> { return inav.inavGetMcBraking(this.queue) }
  async setMcBraking(b: INavMcBraking): Promise<CommandResult> { return this.persist(() => inav.inavSetMcBraking(this.queue, b)) }
  async getRateDynamics(): Promise<INavRateDynamics> { return inav.inavGetRateDynamics(this.queue) }
  async setRateDynamics(r: INavRateDynamics): Promise<CommandResult> { return this.persist(() => inav.inavSetRateDynamics(this.queue, r)) }
  async getEzTune() { return inav.inavGetEzTune(this.queue) }
  async setEzTune(cfg: Parameters<typeof inav.inavSetEzTune>[1]) { return this.persist(() => inav.inavSetEzTune(this.queue, cfg)) }
  async getFwApproach(): Promise<INavFwApproach[]> {
    const approaches: INavFwApproach[] = []
    for (let i = 0; i < INAV_LIMITS.FW_APPROACHES; i++) {
      approaches.push(await inav.inavGetFwApproach(this.queue, i))
    }
    return approaches
  }
  async setFwApproach(a: Parameters<typeof inav.inavSetFwApproach>[1]) { return this.persist(() => inav.inavSetFwApproach(this.queue, a)) }
  async getOsdLayoutsHeader() { return inav.inavGetOsdLayoutsHeader(this.queue) }
  async getOsdAlarms() { return inav.inavGetOsdAlarms(this.queue) }
  async setOsdAlarms(a: Parameters<typeof inav.inavSetOsdAlarms>[1]) { return this.persist(() => inav.inavSetOsdAlarms(this.queue, a)) }
  async getOsdPreferences() { return inav.inavGetOsdPreferences(this.queue) }
  async setOsdPreferences(p: Parameters<typeof inav.inavSetOsdPreferences>[1]) { return this.persist(() => inav.inavSetOsdPreferences(this.queue, p)) }
  async getCustomOsdElements() { return inav.inavGetCustomOsdElements(this.queue) }
  async setCustomOsdElement(el: Parameters<typeof inav.inavSetCustomOsdElement>[1]) { return this.persist(() => inav.inavSetCustomOsdElement(this.queue, el)) }
  async downloadLogicConditions() { return inav.inavDownloadLogicConditions(this.queue) }
  async uploadLogicConditions(rules: Parameters<typeof inav.inavUploadLogicCondition>[2][]): Promise<CommandResult> {
    return this.persist(async () => {
      for (let i = 0; i < rules.length; i++) {
        const r = await inav.inavUploadLogicCondition(this.queue, i, rules[i])
        if (!r.success) return { ...r, message: `Logic condition ${i}: ${r.message}` }
      }
      return { success: true, resultCode: 0, message: `${rules.length} logic conditions saved` }
    })
  }
  async downloadLogicConditionsStatus() { return inav.inavDownloadLogicConditionsStatus(this.queue) }
  async downloadGvarStatus() { return inav.inavDownloadGvarStatus(this.queue) }
  // A live runtime value, not stored config: no EEPROM write.
  async setGvar(index: number, value: number) { return inav.inavSetGvar(this.queue, index, value) }
  async downloadProgrammingPids() { return inav.inavDownloadProgrammingPids(this.queue) }
  async uploadProgrammingPids(pids: Parameters<typeof inav.inavUploadProgrammingPid>[2][]): Promise<CommandResult> {
    return this.persist(async () => {
      for (let i = 0; i < pids.length; i++) {
        const r = await inav.inavUploadProgrammingPid(this.queue, i, pids[i])
        if (!r.success) return { ...r, message: `Programming PID ${i}: ${r.message}` }
      }
      return { success: true, resultCode: 0, message: `${pids.length} programming PIDs saved` }
    })
  }
  async downloadProgrammingPidStatus() { return inav.inavDownloadProgrammingPidStatus(this.queue) }
  async downloadMotorMixer(): Promise<MotorMixerRule[]> { return inav.inavDownloadMotorMixer(this.queue) }
  async uploadMotorMixer(rules: MotorMixerRule[]): Promise<void> { return this.persistOrThrow(() => inav.inavUploadMotorMixer(this.queue, rules)) }
  async downloadServoMixer(): Promise<INavServoMixerRule[]> { return inav.inavDownloadServoMixer(this.queue) }
  async uploadServoMixer(rules: INavServoMixerRule[]): Promise<void> { return this.persistOrThrow(() => inav.inavUploadServoMixer(this.queue, rules)) }

  // ── Mode and adjustment ranges (Betaflight / iNav) ───────────
  private get isBetaflight(): boolean { return this.vehicleInfo?.firmwareType === 'betaflight' }
  async getModeBoxes(): Promise<MspModeBox[]> { return ranges.mspGetModeBoxes(this.queue) }
  async getModeRanges(): Promise<MspModeRange[]> { return ranges.mspGetModeRanges(this.queue, this.isBetaflight) }
  async setModeRanges(r: MspModeRange[]): Promise<CommandResult> {
    const result = await this.persist(() => ranges.mspSetModeRanges(this.queue, r, this.isBetaflight))
    // Flight-mode commands and the RC override switch modes through these
    // ranges and share this array; update it in place.
    if (result.success) this.modeRanges.splice(0, this.modeRanges.length, ...r.filter((m) => m.rangeStart < m.rangeEnd))
    return result
  }
  async getAdjustmentRanges(): Promise<MspAdjustmentRange[]> { return ranges.mspGetAdjustmentRanges(this.queue) }
  async setAdjustmentRanges(r: MspAdjustmentRange[]): Promise<CommandResult> { return this.persist(() => ranges.mspSetAdjustmentRanges(this.queue, r)) }

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

  // ── Betaflight binary config (serial, OSD, LED strip, receiver) ──
  /** Which serial transport answered the last read: MSP2 32-bit mask or the legacy U16 one. */
  private _serialUsesV2: boolean | null = null

  async getSerialConfig(): Promise<MspSerialPort[]> {
    const { ports, extended } = await bf.bfGetSerialConfig(this.queue)
    this._serialUsesV2 = extended
    return ports
  }
  /** Whether the current serial config carries the 32-bit (MSP2) function mask. */
  serialConfigExtended(): boolean { return this._serialUsesV2 === true }
  async setSerialConfig(ports: MspSerialPort[]): Promise<CommandResult> { return this.persist(() => bf.bfSetSerialConfig(this.queue, ports, this._serialUsesV2 !== false)) }
  async sendDshotCommand(commandType: number, motorIndex: number, commands: number[]): Promise<CommandResult> { return bf.bfSendDshotCommand(this.queue, commandType, motorIndex, commands) }
  async getOsdConfig(): Promise<MspOsdConfig> { return bf.bfGetOsdConfig(this.queue) }
  async writeOsdLayout(items: Array<{ index: number; position: number }>, general?: MspOsdGeneralConfig): Promise<CommandResult> { return this.persist(() => bf.bfWriteOsdLayout(this.queue, items, general)) }
  async uploadOsdFont(glyphs: Uint8Array[], onProgress?: (done: number, total: number) => void): Promise<CommandResult> { return bf.bfUploadOsdFont(this.queue, glyphs, onProgress) }
  async getLedStripConfig(): Promise<number[]> { return bf.bfGetLedStripConfig(this.queue) }
  async setLedStripConfig(leds: number[]): Promise<CommandResult> { return this.persist(() => bf.bfSetLedStripConfig(this.queue, leds)) }
  async getLedColors(): Promise<HsvColor[]> { return bf.bfGetLedColors(this.queue) }
  async setLedColors(colors: HsvColor[]): Promise<CommandResult> { return this.persist(() => bf.bfSetLedColors(this.queue, colors)) }
  async getLedStripModeColors(): Promise<BfLedModeColor[]> { return bf.bfGetLedStripModeColors(this.queue) }
  async setLedStripModeColors(entries: BfLedModeColor[]): Promise<CommandResult> { return this.persist(() => bf.bfSetLedStripModeColors(this.queue, entries)) }

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

  async getRxConfig(): Promise<BfRxConfig> { return bf.bfGetRxConfig(this.queue) }
  async setRxConfig(cfg: BfRxConfig): Promise<CommandResult> { return this.persist(() => bf.bfSetRxConfig(this.queue, cfg)) }
  async getRxMap(): Promise<number[]> { return bf.bfGetRxMap(this.queue) }
  async setRxMap(map: number[]): Promise<CommandResult> { return this.persist(() => bf.bfSetRxMap(this.queue, map)) }

  // ── Parameters ──────────────────────────────────────────────
  async getAllParameters() { const c = this.prmCtx; const r = await prm.mspGetAllParameters(c); this.paramNameCache = c.paramNameCache; return r }
  async getParameter(name: string) { return prm.mspGetParameter(this.prmCtx, name) }
  async setParameter(name: string, value: number) { return prm.mspSetParameter(this.prmCtx, name, value) }
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

  /**
   * Why the RC override is inert, or null when it will reach `rcData[]`.
   *
   * The override object computes this once at connect from the feature word
   * and the configured mode ranges. Before connect there is no override, and
   * a link with no override sends nothing.
   */
  getManualControlBlockedReason(): string | null {
    if (!this.rcOverride) return this._connected ? 'the RC override is not set up on this link' : null
    return this.rcOverride.blockedReason
  }

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
  getCommandQueueSnapshot() { return { pendingCount: 0, entries: [] } }
}
