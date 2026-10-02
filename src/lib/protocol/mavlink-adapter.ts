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
  DroneProtocol, Transport, VehicleInfo, CommandResult,
  MissionItem, FirmwareHandler, ProtocolCapabilities, UnifiedFlightMode,
  LogDownloadProgressCallback, FtpDownloadProgressCallback, LinkInfo, GuidedGotoOptions,
  FenceElement,
} from './types'
import { MAVLinkParser, type MAVLinkFrame } from './mavlink-parser'
import { encodeHeartbeat, MAV_CMD_SET_EKF_SOURCE_SET } from './mavlink-encoder'
import { MAV_CMD_CAN_FORWARD, encodeCanFrame, encodeCanFdFrame } from './encoders/can-forward'
import { decodeHeartbeat } from './mavlink-messages'
import { isAutopilotHeartbeat } from './heartbeat-source'
import { CommandQueue, MAV_RESULT } from './command-queue'
import { TELEMETRY_STALE_MS } from '@/lib/telemetry/freshness'
import { createFirmwareHandler } from './firmware/ardupilot'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'
import { createCallbackStore, bindCallbackMethods } from './mavlink-adapter-callbacks'
import { routeFrame, checkLinkState, requestDataStreams, MSG_NAMES, type FrameHandlerState } from './mavlink-adapter-frame-handlers'
import { StatusTextAssembler } from './handlers/info-handlers'
import * as cmds from './mavlink-adapter-commands'
import * as prm from './mavlink-adapter-params'
import * as msn from './mavlink-adapter-missions'
import * as logOps from './mavlink-adapter-logs'
import * as ftpOps from './mavlink-adapter-ftp'
import * as ftpWriteOps from './mavlink-adapter-ftp-ops'
import { SigningTransport } from './signing-transport'
import type { MavlinkSigner } from './mavlink-signer'
import type { ConnectionMeta } from '@/lib/connection-meta'

/** Per-link state for multi-link support. Each link is a Transport that can reach this drone. */
interface LinkState {
  id: string
  transport: Transport
  /** `transport` as seen by senders: signs each v2 frame while a signer is set. */
  outbound: SigningTransport
  /**
   * This link's own frame parser. A parser holds partial frames between
   * chunks, so two links sharing one would splice a chunk from one link into
   * a frame from the other and lose both to the CRC check.
   */
  parser: MAVLinkParser
  label: string
  connectionMeta?: ConnectionMeta
  connectedAt: number
  /** Last time bytes were received on this link (ms) — used for "primary" selection */
  lastByteAt: number
  dataHandler: (data: Uint8Array) => void
  closeHandler: () => void
}

type LinkFrameListener = (frame: MAVLinkFrame, linkId: string) => void

let _linkIdCounter = 0
const nextLinkId = () => `link-${++_linkIdCounter}-${Date.now()}`

export class MAVLinkAdapter implements DroneProtocol {
  readonly protocolName = 'mavlink'

  // Internal state
  /** True while this adapter routes link frames into its state machines. */
  private routing = false
  /** Frame observers across every link, told which link delivered each frame. */
  private frameListeners: LinkFrameListener[] = []
  private commandQueue = new CommandQueue(3000)
  /** Multi-link support — Map of active transports reaching this drone. */
  private links = new Map<string, LinkState>()
  private _connected = false
  private _disconnected = false
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private streamRequestInterval: ReturnType<typeof setInterval> | null = null
  private linkLostCheckInterval: ReturnType<typeof setInterval> | null = null
  /** Signs every outbound v2 frame when set; null sends unsigned. */
  private signer: MavlinkSigner | null = null

  /**
   * The "primary" transport — the link with the most recent byte activity.
   *
   * This is the liveness notion: which link is currently carrying this
   * vehicle's telemetry. It is deliberately *not* the send target, because
   * the busiest link can be receive-only.
   */
  private get transport(): Transport | null {
    if (this.links.size === 0) return null
    let primary: LinkState | null = null
    for (const link of this.links.values()) {
      if (!primary || link.lastByteAt > primary.lastByteAt) primary = link
    }
    return primary?.transport ?? null
  }

  /**
   * The link every outbound byte goes through.
   *
   * A receive-only link (`canCommand === false`) can easily be the busiest —
   * a relay downlink pushing video-rate telemetry while the uplink sits idle
   * between operator actions. Selecting purely on byte recency therefore
   * aimed every command at the link that discards it, while a perfectly good
   * commanding link sat unused beside it.
   *
   * So: prefer the most recently active link that can actually command. When
   * none can, fall back to the primary rather than null, so the honest
   * `canCommand` refusals downstream still read the real link state instead
   * of reporting "Not connected" for a link that is connected and simply
   * cannot carry a command.
   */
  private get commandTransport(): Transport | null {
    if (this.links.size === 0) return null
    let best: LinkState | null = null
    let primary: LinkState | null = null
    for (const link of this.links.values()) {
      if (!primary || link.lastByteAt > primary.lastByteAt) primary = link
      if (!link.transport.canCommand || !link.transport.isConnected) continue
      if (!best || link.lastByteAt > best.lastByteAt) best = link
    }
    return (best ?? primary)?.outbound ?? null
  }

  /**
   * Sign every outbound MAVLink v2 frame with `signer`, or send unsigned
   * with null. Takes effect on the next frame on every link.
   */
  setSigner(signer: MavlinkSigner | null): void {
    this.signer = signer
  }
  private cbs = createCallbackStore()
  private cbm = bindCallbackMethods(this.cbs)
  private paramCache = new Map<string, prm.ParamCacheEntry>()
  /** Latched once on PX4 to keep the console clean if the UI retries the call. */
  private px4EkfSourceWarned = false
  /**
   * Single shared FTP context. The download method, the inbound frame handler,
   * and the session timers all operate on this one object so a session that
   * completes (or times out) via any path clears the same `ftpDownload` slot.
   * Link and identity fields read live from the adapter.
   */
  private readonly _ftpCtx: ftpOps.FtpContext = (() => {
    // The getters below read the adapter's live link and identity.
    const adapter = this
    return {
      get transport() { return adapter.commandTransport },
      get targetSysId() { return adapter.st.targetSysId },
      get targetCompId() { return adapter.st.targetCompId },
      get sysId() { return adapter.st.sysId },
      get compId() { return adapter.st.compId },
      ftpDownload: null, ftpOp: null,
    }
  })()

  get isConnected(): boolean { return this._connected }

  /**
   * The adapter's one mutable protocol state. Frame handlers, transfer timers
   * and the adapter's methods all read and write this object, so a transfer
   * that settles on any path is settled for every path. `transport` reads the
   * current command link on every access.
   */
  private readonly st: FrameHandlerState = (() => {
    // The transport getter reads the adapter's live link.
    const adapter = this
    return {
      get transport() { return adapter.commandTransport },
      firmwareHandler: null, vehicleInfo: null,
      targetSysId: 1, targetCompId: 1, sysId: 255, compId: 190,
      commandQueue: this.commandQueue, cbs: this.cbs, paramCache: this.paramCache,
      PARAM_CACHE_TTL_MS: 300000,
      onParameter: this.cbm.onParameter,
      sendCommandLong: (cmd, p, timeout) => this.sendCommandLong(cmd, p, timeout),
      parameterDownload: null, downloadedParamNames: null, missionUpload: null, missionDownload: null,
      rallyUpload: null, rallyDownload: null, fenceUpload: null, fenceDownload: null,
      transferChains: new Map(),
      logListDownload: null, logDataDownload: null, ftpCtx: this._ftpCtx,
      lastVehicleHeartbeat: 0, linkIsLost: false, HEARTBEAT_TIMEOUT_MS: TELEMETRY_STALE_MS,
      componentMetadataUri: null, statusText: new StatusTextAssembler(), homeAltitudeAmsl: null,
    }
  })()

  /** Attach a transport as a link. Returns the link state. */
  private attachLink(transport: Transport, label: string, meta?: ConnectionMeta): LinkState {
    const id = nextLinkId()
    const parser = new MAVLinkParser()
    const link: LinkState = {
      id,
      transport,
      outbound: new SigningTransport(transport, () => this.signer),
      parser,
      label,
      connectionMeta: meta,
      connectedAt: Date.now(),
      lastByteAt: 0,
      dataHandler: (data: Uint8Array) => {
        link.lastByteAt = Date.now()
        parser.feed(data)
      },
      closeHandler: () => this.handleLinkClose(id),
    }
    parser.onFrame((frame) => this.dispatchLinkFrame(frame, id))
    transport.on('data', link.dataHandler)
    transport.on('close', link.closeHandler as (data: void) => void)
    this.links.set(id, link)
    return link
  }

  /** Route one link's frame into the adapter state machines, then to every listener. */
  private dispatchLinkFrame(frame: MAVLinkFrame, linkId: string): void {
    if (this.routing) this.handleFrame(frame)
    for (const listener of [...this.frameListeners]) {
      try {
        listener(frame, linkId)
      } catch (err) {
        console.warn('[MAVLink] frame listener threw, continuing', err)
      }
    }
  }

  private listenFrames(listener: LinkFrameListener): () => void {
    this.frameListeners.push(listener)
    return () => {
      const i = this.frameListeners.indexOf(listener)
      if (i !== -1) this.frameListeners.splice(i, 1)
    }
  }

  /** Detach a single link's transport handlers (does not disconnect the transport). */
  private detachLink(link: LinkState): void {
    link.transport.off('data', link.dataHandler)
    link.transport.off('close', link.closeHandler as (data: void) => void)
    link.parser.reset()
    this.links.delete(link.id)
  }

  // ── Connection ─────────────────────────────────────────
  async connect(transport: Transport): Promise<VehicleInfo> {
    this._disconnected = false
    const label = this.formatLinkLabel(transport)
    const link = this.attachLink(transport, label)
    // Route frames for this connection; handleDisconnect stops it. The router
    // is on before the heartbeat wait so nothing arriving with the first
    // heartbeat is lost.
    this.routing = true

    // The heartbeat wait, with BOTH exits cleaned up. The timeout used to
    // reject without calling `unsub()`, so every failed connect left a
    // frame listener on the parser and left the transport attached — the
    // dialog reported a failure while the link kept running underneath,
    // and each retry added another listener.
    const gate = Promise.withResolvers<VehicleInfo>()
    const timeout = setTimeout(
      () => gate.reject(new Error('No heartbeat received within 10 seconds')),
      10000,
    )
    const unsub = this.listenFrames((frame, linkId) => {
      if (linkId === link.id && frame.msgId === 0) {
        const hb = decodeHeartbeat(frame.payload)
        // A companion computer, gimbal or camera on the vehicle's sysid must
        // not win the lock: every command would target it instead of the FC.
        if (!isAutopilotHeartbeat(hb)) return
        const st = this.st
        st.targetSysId = frame.systemId; st.targetCompId = frame.componentId
        st.firmwareHandler = createFirmwareHandler(hb.autopilot, hb.type)
        const info: VehicleInfo = {
          firmwareType: st.firmwareHandler.firmwareType, vehicleClass: st.firmwareHandler.vehicleClass,
          firmwareVersionString: st.firmwareHandler.getFirmwareVersion(),
          systemId: frame.systemId, componentId: frame.componentId,
          autopilotType: hb.autopilot, vehicleType: hb.type,
        }
        st.vehicleInfo = info; gate.resolve(info)
      }
    })

    let vehicleInfo: VehicleInfo
    try {
      vehicleInfo = await gate.promise
    } catch (err) {
      clearTimeout(timeout)
      unsub()
      this.routing = false
      this.detachLink(link)
      throw err
    }
    clearTimeout(timeout)
    unsub()

    this._connected = true
    // The GCS heartbeat is housekeeping: it announces us to the vehicle and
    // nothing awaits it. A receive-only link cannot carry it, so skip rather
    // than send — the transport refuses a write it cannot deliver, and letting
    // that throw here would reject connect() and cost the operator the
    // telemetry the link still carries perfectly well.
    this.heartbeatInterval = setInterval(() => {
      const link = this.commandTransport
      if (link?.isConnected && link.canCommand) {
        this.sendWrapped(encodeHeartbeat(this.st.sysId, this.st.compId))
      }
    }, 1000)
    if (transport.canCommand) {
      this.sendWrapped(encodeHeartbeat(this.st.sysId, this.st.compId))
    }
    requestDataStreams(this.st)
    this.streamRequestInterval = setInterval(() => requestDataStreams(this.st), 10000)
    this.st.lastVehicleHeartbeat = Date.now(); this.st.linkIsLost = false
    this.linkLostCheckInterval = setInterval(() => checkLinkState(this.st), 1000)
    this.sendCommandLong(512, [242, 0, 0, 0, 0, 0, 0]).catch(() => {})
    this.sendCommandLong(512, [148, 0, 0, 0, 0, 0, 0]).catch(() => {})
    // COMPONENT_METADATA (397) is a PX4-only "component information" message;
    // ArduPilot does not implement it, so only request it for PX4 vehicles.
    if (this.st.firmwareHandler?.firmwareType === 'px4') {
      this.sendCommandLong(512, [397, 0, 0, 0, 0, 0, 0]).catch(() => {})
    }
    return vehicleInfo
  }

  /**
   * Add an additional transport as a link to this drone.
   * Validates that the new transport reaches the same sysid as the existing connection.
   */
  async addLink(transport: Transport): Promise<{ ok: true; linkId: string } | { ok: false; error: string }> {
    if (!this._connected || this.st.targetSysId === 0) {
      return { ok: false, error: 'Adapter is not connected to a primary link' }
    }
    if (this._disconnected) {
      return { ok: false, error: 'Adapter is disconnected' }
    }
    const label = this.formatLinkLabel(transport)
    const link = this.attachLink(transport, label)

    // Wait for a heartbeat from the SAME sysid
    const expectedSysId = this.st.targetSysId
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        unsub()
        this.detachLink(link)
        resolve({ ok: false, error: 'No heartbeat received on new link within 10 seconds' })
      }, 10000)
      const unsub = this.listenFrames((frame, linkId) => {
        // Only a heartbeat that arrived on *this* link says anything about
        // where this link reaches.
        if (linkId !== link.id || frame.msgId !== 0) return
        const hb = decodeHeartbeat(frame.payload)
        if (!isAutopilotHeartbeat(hb)) return
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
    const st = this.st
    this.commandQueue.clear(); st.statusText.clear(); this.paramCache.clear(); st.downloadedParamNames = null
    this.routing = false
    st.componentMetadataUri = null; st.homeAltitudeAmsl = null
    logOps.cancelLogList(st, 'Disconnected during log list')
    if (st.logDataDownload) logOps.cancelLogDownload(st, 'Disconnected during log download')
    const ftp = this._ftpCtx.ftpDownload
    if (ftp) { if (ftp.inactivityTimer) clearTimeout(ftp.inactivityTimer); clearTimeout(ftp.hardTimer); ftp.reject(new Error('Disconnected during FTP download')); this._ftpCtx.ftpDownload = null }
    prm.finishParamDownload(st)
    msn.cancelMissionTransfers(st, 'Disconnected during mission transfer')
    ftpWriteOps.cancelFtpOp(this._ftpCtx, 'Disconnected during FTP operation')
    // Detach all remaining links
    for (const link of Array.from(this.links.values())) {
      this.detachLink(link)
    }
  }

  /** Every frame the link parser accepts (reassembled, CRC-checked, signature stripped). */
  onMavlinkFrame(callback: (frame: MAVLinkFrame) => void): () => void { return this.listenFrames((frame) => callback(frame)) }

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
    const s = this.st
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
    diag.recordFrameProcessingTime(performance.now() - startTime)
  }

  // ── Context helpers ────────────────────────────────────
  private get cc(): cmds.CommandContext { const s = this.st; return { transport: this.commandTransport, firmwareHandler: s.firmwareHandler, commandQueue: this.commandQueue, targetSysId: s.targetSysId, targetCompId: s.targetCompId, sysId: s.sysId, compId: s.compId, homeAltitudeAmsl: s.homeAltitudeAmsl, sendCommandLong: this.sendCommandLong.bind(this), sendCommandInt: this.sendCommandIntTracked.bind(this) } }

  // ── Delegated Commands ─────────────────────────────────
  async arm() { return cmds.cmdArm(this.cc) }
  async disarm() { return cmds.cmdDisarm(this.cc) }
  async setFlightMode(m: UnifiedFlightMode) { return cmds.cmdSetFlightMode(this.cc, m) }
  async returnToLaunch() { return cmds.cmdReturnToLaunch(this.cc) }
  async land(at?: { lat: number; lon: number }) { return cmds.cmdLand(this.cc, at) }
  async takeoff(alt: number) { return cmds.cmdTakeoff(this.cc, alt) }
  sendManualControl(r: number, p: number, t: number, y: number, b: number) { cmds.cmdSendManualControl(this.cc, r, p, t, y, b) }
  async startCalibration(type: 'accel'|'gyro'|'compass'|'level'|'airspeed'|'baro'|'rc'|'esc'|'compassmot') { return cmds.cmdStartCalibration(this.cc, type) }
  confirmAccelCalPos(pos: number) { cmds.cmdConfirmAccelCalPos(this.cc, pos) }
  async acceptCompassCal(mask = 0) { return cmds.cmdAcceptCompassCal(this.cc, mask) }
  async cancelCompassCal(mask = 0) { return cmds.cmdCancelCompassCal(this.cc, mask) }
  async cancelCalibration() { return cmds.cmdCancelCalibration(this.cc) }
  async startGnssMagCal(yawDeg: number) { return cmds.cmdStartGnssMagCal(this.cc, yawDeg) }
  async sendCommand(id: number, p: number[]) { return cmds.cmdSendCommand(this.cc, id, p) }
  async motorTest(m: number, t: number, d: number) { return cmds.cmdMotorTest(this.cc, m, t, d) }
  async rebootToBootloader() { return cmds.cmdRebootToBootloader(this.cc) }
  async reboot() { return cmds.cmdReboot(this.cc) }
  async resetParametersToDefault() { return cmds.cmdResetParametersToDefault(this.cc) }
  async killSwitch(confirmed: boolean) { return cmds.cmdKillSwitch(this.cc, confirmed) }
  async guidedGoto(lat: number, lon: number, alt: number, options?: GuidedGotoOptions) { return cmds.cmdGuidedGoto(this.cc, lat, lon, alt, options) }
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
    if (this.st.firmwareHandler?.firmwareType === 'px4') {
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
    const s = this.st
    const frame = encodeCanFrame(
      s.targetSysId, s.targetCompId, bus,
      { id, extended: (id & 0x80000000) !== 0, dlc: data.length, data },
      s.sysId, s.compId,
    )
    this.sendWrapped(frame)
  }

  /** Send a CANFD_FRAME (msg 387) over the active transport. Fire-and-forget. */
  sendCanFdFrame(bus: number, id: number, data: Uint8Array): void {
    if (!this.transport?.isConnected) return
    const s = this.st
    const frame = encodeCanFdFrame(
      s.targetSysId, s.targetCompId, bus,
      { id, extended: (id & 0x80000000) !== 0, dlc: data.length, data },
      s.sysId, s.compId,
    )
    this.sendWrapped(frame)
  }

  // ── Delegated Parameters ───────────────────────────────
  async getAllParameters() { return prm.getAllParameters(this.st) }
  getCachedParameterNames() { return prm.getCachedParameterNames(this.st) }
  async getParameter(name: string) { return prm.getParameter(this.st, name) }
  async setParameter(name: string, value: number) { return prm.setParameter(this.st, name, value) }

  // ── Delegated Missions ─────────────────────────────────
  async uploadMission(items: MissionItem[]) { return msn.uploadMission(this.st, items) }
  async downloadMission() { return msn.downloadMission(this.st) }
  async setCurrentMissionItem(seq: number) { return msn.setCurrentMissionItem(this.st, seq) }
  async clearMission() { return msn.clearMission(this.st) }
  async uploadFenceMission(elements: FenceElement[]) { return msn.uploadFenceMission(this.st, elements) }
  async downloadFenceMission() { return msn.downloadFenceMission(this.st) }
  async uploadRallyPoints(pts: Array<{ lat: number; lon: number; alt: number }>) { return msn.uploadRallyPoints(this.st, pts) }
  async downloadRallyPoints() { return msn.downloadRallyPoints(this.st) }

  // ── Delegated Logs ─────────────────────────────────────
  async getLogList() { return logOps.getLogList(this.st) }
  async downloadLog(id: number, onProgress?: LogDownloadProgressCallback) { return logOps.downloadLog(this.st, id, onProgress) }
  async eraseAllLogs() { return logOps.eraseAllLogs(this.st) }
  cancelLogDownload() { logOps.cancelLogDownload(this.st) }

  // ── Delegated FTP ──────────────────────────────────────
  async downloadFileViaFtp(path: string, onProgress?: FtpDownloadProgressCallback) { return ftpOps.downloadFileViaFtp(this._ftpCtx, path, onProgress) }
  cancelFtpDownload() { ftpOps.cancelFtp(this._ftpCtx) }
  // Write ops (upload/list/remove) — deliberate operator actions, e.g. Lua
  // script management. Transport-agnostic, so they work direct-to-FC and over
  // the agent's transparent MAVLink pipe alike.
  async uploadFileViaFtp(path: string, bytes: Uint8Array, onProgress?: (written: number, total: number) => void) { return ftpWriteOps.uploadFileViaFtp(this._ftpCtx, path, bytes, onProgress) }
  async listDirectoryViaFtp(path: string) { return ftpWriteOps.listDirectoryViaFtp(this._ftpCtx, path) }
  async removeFileViaFtp(path: string) { return ftpWriteOps.removeFileViaFtp(this._ftpCtx, path) }

  // ── Component Metadata ──────────────────────────────────
  getComponentMetadataUri(): string | null { return this.st.componentMetadataUri ?? null }

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
  onAdsbVehicle = this.cbm.onAdsbVehicle
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
  getVehicleInfo(): VehicleInfo | null { return this.st.vehicleInfo }
  getCapabilities(): ProtocolCapabilities {
    return this.st.firmwareHandler?.getCapabilities() ?? {
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
  getFirmwareHandler(): FirmwareHandler | null { return this.st.firmwareHandler }
  getCommandQueueSnapshot() { return { pendingCount: this.commandQueue.pendingCount, entries: this.commandQueue.getSnapshot() } }

  private sendCommandLong(cmd: number, p: [number, number, number, number, number, number, number], timeout?: number): Promise<CommandResult> {
    if (!this.commandTransport?.isConnected) return Promise.resolve({ success: false, resultCode: -1, message: 'Not connected' })
    const s = this.st
    return this.commandQueue.sendCommand(cmd, p, (d) => this.sendWrapped(d), s.targetSysId, s.targetCompId, s.sysId, s.compId, timeout)
  }

  /** Ack-tracked COMMAND_INT, for commands whose x/y need 1e7 integer precision. */
  private sendCommandIntTracked(
    cmd: number,
    p: [number, number, number, number],
    x: number,
    y: number,
    z: number,
    frame: number,
    timeout?: number,
  ): Promise<CommandResult> {
    if (!this.commandTransport?.isConnected) return Promise.resolve({ success: false, resultCode: -1, message: 'Not connected' })
    const s = this.st
    return this.commandQueue.sendCommandInt(cmd, p, x, y, z, frame, (d) => this.sendWrapped(d), s.targetSysId, s.targetCompId, s.sysId, s.compId, timeout)
  }

  /** Send data through the command link.
   * A transport can throw ("Not connected") when it dropped between an
   * isConnected check and the send; swallow + log so a disconnect race never
   * escapes as an uncaught exception on any send path (heartbeat, params,
   * commands). The command queue additionally fails the command on throw. */
  private sendWrapped(data: Uint8Array): void {
    try {
      this.commandTransport?.send(data)
    } catch (err) {
      console.warn('[MAVLinkAdapter] transport send failed:', err)
    }
  }
}
