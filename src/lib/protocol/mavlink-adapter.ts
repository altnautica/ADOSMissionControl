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
  DroneProtocol, Transport, TransportMiddleware, VehicleInfo, CommandResult, ParameterValue,
  MissionItem, FirmwareHandler, ProtocolCapabilities, UnifiedFlightMode,
  LogEntry, LogDownloadProgressCallback, FtpDownloadProgressCallback, LinkInfo,
} from './types'
import { MAVLinkParser, type MAVLinkFrame } from './mavlink-parser'
import { encodeHeartbeat, MAV_CMD_SET_EKF_SOURCE_SET } from './mavlink-encoder'
import { MAV_CMD_CAN_FORWARD, encodeCanFrame, encodeCanFdFrame } from './encoders/can-forward'
import { decodeHeartbeat } from './mavlink-messages'
import { CommandQueue, MAV_RESULT } from './command-queue'
import { createFirmwareHandler } from './firmware/ardupilot'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'
import { createCallbackStore, bindCallbackMethods } from './mavlink-adapter-callbacks'
import { routeFrame, checkLinkState, requestDataStreams, MSG_NAMES, type FrameHandlerState } from './mavlink-adapter-frame-handlers'
import * as cmds from './mavlink-adapter-commands'
import * as prm from './mavlink-adapter-params'
import * as msn from './mavlink-adapter-missions'
import * as logOps from './mavlink-adapter-logs'
import * as ftpOps from './mavlink-adapter-ftp'
import * as ftpWriteOps from './mavlink-adapter-ftp-ops'

/** Per-link state for multi-link support. Each link is a Transport that can reach this drone. */
interface LinkState {
  id: string
  transport: Transport
  label: string
  connectionMeta?: import('@/stores/drone-manager').ConnectionMeta
  connectedAt: number
  /** Last time bytes were received on this link (ms) — used for "primary" selection */
  lastByteAt: number
  dataHandler: (data: Uint8Array) => void
  closeHandler: () => void
}

let _linkIdCounter = 0
const nextLinkId = () => `link-${++_linkIdCounter}-${Date.now()}`

export class MAVLinkAdapter implements DroneProtocol {
  readonly protocolName = 'mavlink'

  // Internal state
  private parser = new MAVLinkParser()
  private commandQueue = new CommandQueue(3000)
  /** Multi-link support — Map of active transports reaching this drone. */
  private links = new Map<string, LinkState>()
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

  /** Returns the "primary" transport — the link with the most recent byte activity. */
  private get transport(): Transport | null {
    if (this.links.size === 0) return null
    let primary: LinkState | null = null
    for (const link of this.links.values()) {
      if (!primary || link.lastByteAt > primary.lastByteAt) primary = link
    }
    return primary?.transport ?? null
  }
  private cbs = createCallbackStore()
  private cbm = bindCallbackMethods(this.cbs)
  private paramCache = new Map<string, prm.ParamCacheEntry>()
  private lastVehicleHeartbeat = 0
  private linkLostCheckInterval: ReturnType<typeof setInterval> | null = null
  private linkIsLost = false
  /** URI from the last COMPONENT_METADATA (msg 397), PX4 only. Null until received. */
  private componentMetadataUri: string | null = null
  private middleware: TransportMiddleware | null = null
  /** Latched once on PX4 to keep the console clean if the UI retries the call. */
  private px4EkfSourceWarned = false

  // Protocol state machines
  private parameterDownload: prm.ParamDownloadState | null = null
  // Names from the last COMPLETE full param download; the "which params exist"
  // oracle used to fast-fail reads of params this board lacks. Cleared on
  // disconnect. Not touched by setParameter, so it stays stable.
  private downloadedParamNames: Set<string> | null = null
  private missionUpload: msn.MissionUploadState | null = null
  private missionDownload: msn.MissionDownloadState | null = null
  private rallyUpload: msn.RallyUploadState | null = null
  private rallyDownload: msn.RallyDownloadState | null = null
  private fenceUpload: msn.FenceUploadState | null = null
  private fenceDownload: msn.FenceDownloadState | null = null
  private logListDownload: logOps.LogListState | null = null
  private logDataDownload: logOps.LogDataState | null = null
  /**
   * Single shared FTP context. The download method, the inbound frame handler,
   * and the session timers all operate on this one object so a session that
   * completes (or times out) via any path clears the same `ftpDownload` slot.
   */
  private _ftpCtx: ftpOps.FtpContext = {
    transport: null, targetSysId: 1, targetCompId: 1, sysId: 255, compId: 190, ftpDownload: null, ftpOp: null,
  }
  private get ftpDownload(): ftpOps.FtpSessionState | null { return this._ftpCtx.ftpDownload }
  private set ftpDownload(v: ftpOps.FtpSessionState | null) { this._ftpCtx.ftpDownload = v }

  get isConnected(): boolean { return this._connected }

  /** Attach optional middleware for intercepting transport data (e.g., encryption). */
  setMiddleware(mw: TransportMiddleware | null): void { this.middleware = mw }

  // ── Shared state object for frame handlers ──────────────
  // Cached mutable object — updated in-place to avoid 50+/sec allocations
  private _fhs: FrameHandlerState = {
    transport: null, firmwareHandler: null, vehicleInfo: null,
    targetSysId: 1, targetCompId: 1, sysId: 255, compId: 190,
    commandQueue: this.commandQueue, cbs: this.cbs, paramCache: this.paramCache,
    parameterDownload: null, downloadedParamNames: null, missionUpload: null, missionDownload: null,
    rallyUpload: null, rallyDownload: null, fenceUpload: null, fenceDownload: null,
    logListDownload: null, logDataDownload: null, ftpCtx: this._ftpCtx,
    lastVehicleHeartbeat: 0, linkIsLost: false, HEARTBEAT_TIMEOUT_MS: 5000,
    componentMetadataUri: null,
  }
  private get fhs(): FrameHandlerState {
    const s = this._fhs
    s.transport = this.transport; s.firmwareHandler = this.firmwareHandler; s.vehicleInfo = this.vehicleInfo
    s.targetSysId = this.targetSysId; s.targetCompId = this.targetCompId; s.sysId = this.sysId; s.compId = this.compId
    s.parameterDownload = this.parameterDownload; s.downloadedParamNames = this.downloadedParamNames; s.missionUpload = this.missionUpload
    s.missionDownload = this.missionDownload; s.rallyUpload = this.rallyUpload; s.rallyDownload = this.rallyDownload
    s.fenceUpload = this.fenceUpload; s.fenceDownload = this.fenceDownload
    s.logListDownload = this.logListDownload; s.logDataDownload = this.logDataDownload
    s.ftpCtx = this.fc
    s.lastVehicleHeartbeat = this.lastVehicleHeartbeat; s.linkIsLost = this.linkIsLost
    s.componentMetadataUri = this.componentMetadataUri
    return s
  }
  private syncFhs(s: FrameHandlerState) {
    this.vehicleInfo = s.vehicleInfo; this.parameterDownload = s.parameterDownload
    this.downloadedParamNames = s.downloadedParamNames
    this.missionUpload = s.missionUpload; this.missionDownload = s.missionDownload
    this.rallyUpload = s.rallyUpload; this.rallyDownload = s.rallyDownload
    this.fenceUpload = s.fenceUpload; this.fenceDownload = s.fenceDownload
    this.logListDownload = s.logListDownload; this.logDataDownload = s.logDataDownload
    // FTP state lives on the shared _ftpCtx (see s.ftpCtx); no copy-back needed.
    this.lastVehicleHeartbeat = s.lastVehicleHeartbeat; this.linkIsLost = s.linkIsLost
    this.componentMetadataUri = s.componentMetadataUri ?? null
  }

  /** Attach a transport as a link. Returns the link state. */
  private attachLink(transport: Transport, label: string, meta?: import('@/stores/drone-manager').ConnectionMeta): LinkState {
    const id = nextLinkId()
    const link: LinkState = {
      id,
      transport,
      label,
      connectionMeta: meta,
      connectedAt: Date.now(),
      lastByteAt: 0,
      dataHandler: (data: Uint8Array) => {
        link.lastByteAt = Date.now()
        this.parser.feed(this.middleware ? this.middleware.unwrapInbound(data) : data)
      },
      closeHandler: () => this.handleLinkClose(id),
    }
    transport.on('data', link.dataHandler)
    transport.on('close', link.closeHandler as (data: void) => void)
    this.links.set(id, link)
    return link
  }

  /** Detach a single link's transport handlers (does not disconnect the transport). */
  private detachLink(link: LinkState): void {
    link.transport.off('data', link.dataHandler)
    link.transport.off('close', link.closeHandler as (data: void) => void)
    this.links.delete(link.id)
  }

  // ── Connection ─────────────────────────────────────────
  async connect(transport: Transport): Promise<VehicleInfo> {
    this._disconnected = false
    const label = this.formatLinkLabel(transport)
    this.attachLink(transport, label)
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
    // The GCS heartbeat is housekeeping: it announces us to the vehicle and
    // nothing awaits it. A receive-only link cannot carry it, so skip rather
    // than send — the transport refuses a write it cannot deliver, and letting
    // that throw here would reject connect() and cost the operator the
    // telemetry the link still carries perfectly well.
    this.heartbeatInterval = setInterval(() => {
      if (this.transport?.isConnected && this.transport.canCommand) {
        this.sendWrapped(encodeHeartbeat(this.sysId, this.compId))
      }
    }, 1000)
    if (transport.canCommand) {
      this.sendWrapped(encodeHeartbeat(this.sysId, this.compId))
    }
    requestDataStreams(this.fhs)
    this.streamRequestInterval = setInterval(() => requestDataStreams(this.fhs), 10000)
    this.lastVehicleHeartbeat = Date.now(); this.linkIsLost = false
    this.linkLostCheckInterval = setInterval(() => { const s = this.fhs; checkLinkState(s); this.syncFhs(s) }, 1000)
    this.sendCommandLong(512, [242, 0, 0, 0, 0, 0, 0]).catch(() => {})
    this.sendCommandLong(512, [148, 0, 0, 0, 0, 0, 0]).catch(() => {})
    // COMPONENT_METADATA (397) is a PX4-only "component information" message;
    // ArduPilot does not implement it, so only request it for PX4 vehicles.
    if (this.firmwareHandler?.firmwareType === 'px4') {
      this.sendCommandLong(512, [397, 0, 0, 0, 0, 0, 0]).catch(() => {})
    }
    return vehicleInfo
  }

  /**
   * Add an additional transport as a link to this drone.
   * Validates that the new transport reaches the same sysid as the existing connection.
   */
  async addLink(transport: Transport): Promise<{ ok: true; linkId: string } | { ok: false; error: string }> {
    if (!this._connected || this.targetSysId === 0) {
      return { ok: false, error: 'Adapter is not connected to a primary link' }
    }
    if (this._disconnected) {
      return { ok: false, error: 'Adapter is disconnected' }
    }
    const label = this.formatLinkLabel(transport)
    const link = this.attachLink(transport, label)

    // Wait for a heartbeat from the SAME sysid
    const expectedSysId = this.targetSysId
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        unsub()
        this.detachLink(link)
        resolve({ ok: false, error: 'No heartbeat received on new link within 10 seconds' })
      }, 10000)
      const unsub = this.parser.onFrame((frame) => {
        if (frame.msgId !== 0) return
        const hb = decodeHeartbeat(frame.payload)
        if (hb.type === 6) return
        // Heuristic: the link with the most recent byte activity just delivered this heartbeat
        const recentLink = this.findMostRecentlyActiveLink()
        if (recentLink?.id !== link.id) return
        if (frame.systemId !== expectedSysId) {
          clearTimeout(timeout); unsub()
          this.detachLink(link)
          resolve({
            ok: false,
            error: `Sysid mismatch: this transport reaches sysid ${frame.systemId} but expected ${expectedSysId}`,
          })
          return
        }
        clearTimeout(timeout); unsub()
        resolve({ ok: true, linkId: link.id })
      })
    })
  }

  /** Remove a link by id. If it's the last link, the adapter disconnects. */
  async removeLink(linkId: string): Promise<void> {
    const link = this.links.get(linkId)
    if (!link) return
    this.detachLink(link)
    if (link.transport.isConnected) {
      try { await link.transport.disconnect() } catch { /* ignore */ }
    }
    if (this.links.size === 0) {
      this.handleDisconnect()
    }
  }

  /** Returns information about all active links for this drone. */
  get linkInfo(): LinkInfo[] {
    const primaryTransport = this.transport
    const result: LinkInfo[] = []
    for (const link of this.links.values()) {
      result.push({
        id: link.id,
        type: link.transport.type,
        label: link.label,
        isConnected: link.transport.isConnected,
        connectedAt: link.connectedAt,
        lastByteAt: link.lastByteAt,
        isPrimary: link.transport === primaryTransport,
      })
    }
    return result.sort((a, b) => a.connectedAt - b.connectedAt)
  }

  private findMostRecentlyActiveLink(): LinkState | null {
    let best: LinkState | null = null
    for (const link of this.links.values()) {
      if (!best || link.lastByteAt > best.lastByteAt) best = link
    }
    return best
  }

  private formatLinkLabel(transport: Transport): string {
    return transport.type
  }

  /** Called when an individual link's transport closes. */
  private handleLinkClose(linkId: string): void {
    const link = this.links.get(linkId)
    if (!link) return
    this.detachLink(link)
    if (this.links.size === 0) {
      this.handleDisconnect()
    }
  }

  async disconnect(): Promise<void> {
    const links = Array.from(this.links.values())
    this.handleDisconnect()
    for (const link of links) {
      if (link.transport.isConnected) {
        try { await link.transport.disconnect() } catch { /* ignore */ }
      }
    }
  }

  private handleDisconnect(): void {
    if (this._disconnected) return
    this._disconnected = true; this._connected = false
    if (this.heartbeatInterval) { clearInterval(this.heartbeatInterval); this.heartbeatInterval = null }
    if (this.streamRequestInterval) { clearInterval(this.streamRequestInterval); this.streamRequestInterval = null }
    if (this.linkLostCheckInterval) { clearInterval(this.linkLostCheckInterval); this.linkLostCheckInterval = null }
    this.commandQueue.clear(); this.paramCache.clear(); this.downloadedParamNames = null; this.parser.reset()
    this.componentMetadataUri = null
    if (this.logListDownload) { clearTimeout(this.logListDownload.timer); this.logListDownload.resolve(Array.from(this.logListDownload.entries.values())); this.logListDownload = null }
    if (this.logDataDownload) { if (this.logDataDownload.inactivityTimer) clearTimeout(this.logDataDownload.inactivityTimer); clearTimeout(this.logDataDownload.hardTimer); this.logDataDownload.reject(new Error('Disconnected during log download')); this.logDataDownload = null }
    if (this.ftpDownload) { if (this.ftpDownload.inactivityTimer) clearTimeout(this.ftpDownload.inactivityTimer); clearTimeout(this.ftpDownload.hardTimer); this.ftpDownload.reject(new Error('Disconnected during FTP download')); this.ftpDownload = null }
    if (this.parameterDownload) { prm.finishParamDownload(this.pc); this.parameterDownload = null }
    ftpWriteOps.cancelFtpOp(this._ftpCtx, 'Disconnected during FTP operation')
    // Detach all remaining links
    for (const link of Array.from(this.links.values())) {
      this.detachLink(link)
    }
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
    const s = this.fhs
    const cbStart = performance.now()
    try {
      routeFrame(s, frame, frame.payload)
    } catch (err) {
      // A throwing handler or store bridge must not propagate back through the
      // parser's feed() loop and stall the rest of the batch. Keep the synced
      // state and continue.
      console.warn(`[MAVLink] routeFrame threw for ${msgName}, continuing`, err)
    }
    // Callback-dispatch latency: time spent fanning out to telemetry
    // subscribers, tracked separately from total frame-processing time.
    diag.recordCallbackLatency(performance.now() - cbStart)
    this.syncFhs(s)
    diag.recordFrameProcessingTime(performance.now() - startTime)
  }

  // ── Context helpers ────────────────────────────────────
  private get cc(): cmds.CommandContext { return { transport: this.transport, firmwareHandler: this.firmwareHandler, commandQueue: this.commandQueue, targetSysId: this.targetSysId, targetCompId: this.targetCompId, sysId: this.sysId, compId: this.compId, sendCommandLong: this.sendCommandLong.bind(this) } }
  private get pc(): prm.ParamContext { return { transport: this.transport, firmwareHandler: this.firmwareHandler, targetSysId: this.targetSysId, targetCompId: this.targetCompId, sysId: this.sysId, compId: this.compId, paramCache: this.paramCache, PARAM_CACHE_TTL_MS: 300000, parameterDownload: this.parameterDownload, downloadedParamNames: this.downloadedParamNames, onParameter: this.onParameter.bind(this) } }
  private get mc(): msn.MissionContext { return { transport: this.transport, firmwareHandler: this.firmwareHandler, targetSysId: this.targetSysId, targetCompId: this.targetCompId, sysId: this.sysId, compId: this.compId, missionUpload: this.missionUpload, missionDownload: this.missionDownload, rallyUpload: this.rallyUpload, rallyDownload: this.rallyDownload, fenceUpload: this.fenceUpload, fenceDownload: this.fenceDownload, sendCommandLong: this.sendCommandLong.bind(this), onParameter: this.onParameter.bind(this), onFencePoint: this.onFencePoint.bind(this), getParameter: this.getParameter.bind(this) } }
  private get lc(): logOps.LogContext { return { transport: this.transport, targetSysId: this.targetSysId, targetCompId: this.targetCompId, sysId: this.sysId, compId: this.compId, logListDownload: this.logListDownload, logDataDownload: this.logDataDownload } }
  private get fc(): ftpOps.FtpContext { const c = this._ftpCtx; c.transport = this.transport; c.targetSysId = this.targetSysId; c.targetCompId = this.targetCompId; c.sysId = this.sysId; c.compId = this.compId; return c }

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
  async setGimbalROI(lat: number, lon: number, alt: number) { return cmds.cmdSetRoiLocation(this.cc, lat, lon, alt) }
  async setRoiLocation(lat: number, lon: number, alt: number) { return cmds.cmdSetRoiLocation(this.cc, lat, lon, alt) }
  async clearRoi() { return cmds.cmdSetRoiNone(this.cc) }
  async orbit(radius: number, velocity: number, yawBehavior: number, lat: number, lon: number, alt: number) { return cmds.cmdOrbit(this.cc, radius, velocity, yawBehavior, lat, lon, alt) }
  async setEkfOrigin(lat: number, lon: number, alt: number) { return cmds.cmdSetEkfOrigin(this.cc, lat, lon, alt) }

  /**
   * Switch the active EKF source set at runtime.
   *
   * ArduPilot path: COMMAND_LONG with MAV_CMD_SET_EKF_SOURCE_SET (42007) and
   * a 1 s ACK timeout. PX4 has no runtime equivalent; the autopilot requires
   * a parameter update plus EKF restart, which is out of scope for this
   * surface, so the call resolves with a typed rejection instead of throwing.
   */
  async setEkfSourceSet(
    sourceSet: 1 | 2 | 3,
  ): Promise<{ ok: true } | { ok: false; reason: 'px4-not-supported' | 'no-ack' | 'rejected' }> {
    if (sourceSet !== 1 && sourceSet !== 2 && sourceSet !== 3) {
      throw new TypeError(`setEkfSourceSet: sourceSet must be 1, 2, or 3 (received ${String(sourceSet)})`)
    }
    if (this.firmwareHandler?.firmwareType === 'px4') {
      if (!this.px4EkfSourceWarned) {
        this.px4EkfSourceWarned = true
        console.warn('PX4 does not support runtime EKF source-set switching, parameter update plus EKF restart required')
      }
      return { ok: false, reason: 'px4-not-supported' }
    }
    const result = await this.sendCommandLong(
      MAV_CMD_SET_EKF_SOURCE_SET,
      [sourceSet, 0, 0, 0, 0, 0, 0],
      1000,
    )
    if (result.success) return { ok: true }
    if (result.resultCode === -1) return { ok: false, reason: 'no-ack' }
    if (
      result.resultCode === MAV_RESULT.TEMPORARILY_REJECTED ||
      result.resultCode === MAV_RESULT.DENIED ||
      result.resultCode === MAV_RESULT.UNSUPPORTED ||
      result.resultCode === MAV_RESULT.FAILED
    ) {
      return { ok: false, reason: 'rejected' }
    }
    return { ok: false, reason: 'rejected' }
  }
  sendSerialData(t: string) { cmds.cmdSendSerialData(this.cc, t) }

  /**
   * Enable MAVLink CAN passthrough on the given bus.
   *
   * Sends MAV_CMD_CAN_FORWARD via COMMAND_LONG. `bus` = 1 or 2 to enable,
   * `bus` = 0 to disable. ACK is awaited so the caller knows the FC
   * accepted the request before opening a CAN client on top.
   */
  async enableCanForward(bus: number) {
    return this.sendCommandLong(MAV_CMD_CAN_FORWARD, [bus, 0, 0, 0, 0, 0, 0])
  }

  /**
   * Test a single actuator output (PX4). `functionCode` is an
   * ACTUATOR_OUTPUT_FUNCTION (Motor1=1..16, Servo1=33..48), `value` is
   * normalized (-1..1; NaN = stop), `timeoutS` auto-restores the output. The
   * FC rejects the command while armed.
   */
  async actuatorTest(functionCode: number, value: number, timeoutS: number) {
    // MAV_CMD_ACTUATOR_TEST (310): p1 value, p2 timeout, p5 output function.
    return this.sendCommandLong(310, [value, timeoutS, 0, 0, functionCode, 0, 0])
  }

  /** Send a CAN_FRAME (msg 386) over the active transport. Fire-and-forget. */
  sendCanFrame(bus: number, id: number, data: Uint8Array): void {
    if (!this.transport?.isConnected) return
    const frame = encodeCanFrame(
      this.targetSysId, this.targetCompId, bus,
      { id, extended: (id & 0x80000000) !== 0, dlc: data.length, data },
      this.sysId, this.compId,
    )
    this.sendWrapped(frame)
  }

  /** Send a CANFD_FRAME (msg 387) over the active transport. Fire-and-forget. */
  sendCanFdFrame(bus: number, id: number, data: Uint8Array): void {
    if (!this.transport?.isConnected) return
    const frame = encodeCanFdFrame(
      this.targetSysId, this.targetCompId, bus,
      { id, extended: (id & 0x80000000) !== 0, dlc: data.length, data },
      this.sysId, this.compId,
    )
    this.sendWrapped(frame)
  }
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
  async uploadFenceMission(elements: import('./types').FenceElement[]) { const c = this.mc; const p = msn.uploadFenceMission(c, elements); this.fenceUpload = c.fenceUpload; const r = await p; this.fenceUpload = c.fenceUpload; return r }
  async downloadFenceMission() { const c = this.mc; const p = msn.downloadFenceMission(c); this.fenceDownload = c.fenceDownload; const r = await p; this.fenceDownload = c.fenceDownload; return r }
  async uploadRallyPoints(pts: Array<{ lat: number; lon: number; alt: number }>) { const c = this.mc; const p = msn.uploadRallyPoints(c, pts); this.rallyUpload = c.rallyUpload as msn.RallyUploadState | null; const r = await p; this.rallyUpload = c.rallyUpload as msn.RallyUploadState | null; return r }
  async downloadRallyPoints() { const c = this.mc; const p = msn.downloadRallyPoints(c); this.rallyDownload = c.rallyDownload as msn.RallyDownloadState | null; const r = await p; this.rallyDownload = c.rallyDownload as msn.RallyDownloadState | null; return r }

  // ── Delegated Logs ─────────────────────────────────────
  async getLogList() { const c = this.lc; const p = logOps.getLogList(c); this.logListDownload = c.logListDownload; const r = await p; this.logListDownload = c.logListDownload; return r }
  async downloadLog(id: number, onProgress?: LogDownloadProgressCallback) { const c = this.lc; const p = logOps.downloadLog(c, id, onProgress); this.logDataDownload = c.logDataDownload; const r = await p; this.logDataDownload = c.logDataDownload; return r }
  async eraseAllLogs() { return logOps.eraseAllLogs(this.lc) }
  cancelLogDownload() { const c = this.lc; logOps.cancelLogDownload(c); this.logListDownload = c.logListDownload; this.logDataDownload = c.logDataDownload }

  // ── Delegated FTP ──────────────────────────────────────
  async downloadFileViaFtp(path: string, onProgress?: FtpDownloadProgressCallback) { return ftpOps.downloadFileViaFtp(this.fc, path, onProgress) }
  cancelFtpDownload() { ftpOps.cancelFtp(this.fc) }
  // Write ops (upload/list/remove) — deliberate operator actions, e.g. Lua
  // script management. Transport-agnostic, so they work direct-to-FC and over
  // the agent's transparent MAVLink pipe alike.
  async uploadFileViaFtp(path: string, bytes: Uint8Array, onProgress?: (written: number, total: number) => void) { return ftpWriteOps.uploadFileViaFtp(this.fc, path, bytes, onProgress) }
  async listDirectoryViaFtp(path: string) { return ftpWriteOps.listDirectoryViaFtp(this.fc, path) }
  async removeFileViaFtp(path: string) { return ftpWriteOps.removeFileViaFtp(this.fc, path) }

  // ── Component Metadata ──────────────────────────────────
  getComponentMetadataUri(): string | null { return this.componentMetadataUri }

  // ── Telemetry Subscriptions ────────────────────────────
  onAttitude = this.cbm.onAttitude; onPosition = this.cbm.onPosition; onBattery = this.cbm.onBattery
  onGps = this.cbm.onGps; onVfr = this.cbm.onVfr; onRc = this.cbm.onRc
  onStatusText = this.cbm.onStatusText; onEvent = this.cbm.onEvent; onHeartbeat = this.cbm.onHeartbeat
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
  onCanFrame = this.cbm.onCanFrame; onCanFdFrame = this.cbm.onCanFdFrame
  onOpticalFlow = this.cbm.onOpticalFlow; onOpticalFlowRad = this.cbm.onOpticalFlowRad
  onOdometry = this.cbm.onOdometry
  onVisionPositionEstimate = this.cbm.onVisionPositionEstimate
  onVisionPositionDelta = this.cbm.onVisionPositionDelta

  // ── Info ────────────────────────────────────────────────
  getVehicleInfo(): VehicleInfo | null { return this.vehicleInfo }
  getCapabilities(): ProtocolCapabilities {
    return this.firmwareHandler?.getCapabilities() ?? {
      supportsArming: false, supportsFlightModes: false, supportsMissionUpload: false, supportsMissionDownload: false,
      supportsManualControl: false, supportsParameters: false, supportsCalibration: false, supportsSerialPassthrough: false,
      supportsMotorTest: false, supportsAutonomousNav: false, supportsGeoFence: false, supportsRally: false, supportsLogDownload: false,
      supportsOsd: false, supportsDisplayPort: false, supportsPidTuning: false, supportsPorts: false, supportsFailsafe: false,
      supportsPowerConfig: false, supportsReceiver: false, supportsFirmwareFlash: false, supportsCliShell: false,
      supportsMavlinkInspector: false, supportsGimbal: false, supportsCamera: false, supportsLed: false,
      supportsBattery2: false, supportsRangefinder: false, supportsOpticalFlow: false, supportsObstacleAvoidance: false,
      supportsDebugValues: false, supportsCanFrame: false, supportsAuxModes: false, supportsVtx: false, supportsBlackbox: false,
      supportsBetaflightConfig: false, supportsMspMotors: false, supportsGpsConfig: false, supportsEkfConfig: false, supportsStreamRates: false, supportsVtolConfig: false, supportsTecsConfig: false, supportsSubConfig: false, supportsPx4Tuning: false, supportsRateProfiles: false, supportsAdjustments: false,
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
  getCommandQueueSnapshot() { return { pendingCount: this.commandQueue.pendingCount, entries: this.commandQueue.getSnapshot() } }

  private sendCommandLong(cmd: number, p: [number, number, number, number, number, number, number], timeout?: number): Promise<CommandResult> {
    if (!this.transport?.isConnected) return Promise.resolve({ success: false, resultCode: -1, message: 'Not connected' })
    return this.commandQueue.sendCommand(cmd, p, (d) => this.sendWrapped(d), this.targetSysId, this.targetCompId, this.sysId, this.compId, timeout)
  }

  /** Send data through transport, applying outbound middleware if set.
   * A transport can throw ("Not connected") when it dropped between an
   * isConnected check and the send; swallow + log so a disconnect race never
   * escapes as an uncaught exception on any send path (heartbeat, params,
   * commands). The command queue additionally fails the command on throw. */
  private sendWrapped(data: Uint8Array): void {
    try {
      this.transport?.send(this.middleware ? this.middleware.wrapOutbound(data) : data)
    } catch (err) {
      console.warn('[MAVLinkAdapter] transport send failed:', err)
    }
  }
}
