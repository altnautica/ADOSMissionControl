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
 * - mavlink-adapter-camera.ts (finding the vehicle camera, where its commands go)
 *
 * @module protocol/mavlink-adapter
 */

import type {
  DroneProtocol, CommandQueueSnapshot, Transport, VehicleInfo, CommandResult,
  MissionItem, FirmwareHandler, ProtocolCapabilities, UnifiedFlightMode,
  LogDownloadProgressCallback, FtpDownloadProgressCallback, LinkInfo, GuidedGotoOptions,
  FenceElement, RallyPointItem,
} from './types'
import type { MAVLinkFrame } from './mavlink-parser'
import { encodeHeartbeat } from './encoders'
import { CommandQueue } from './command-queue'
import { TELEMETRY_STALE_MS } from '@/lib/telemetry/freshness'
import { createFirmwareHandler } from './firmware/ardupilot'
import { createCallbackStore, bindCallbackMethods } from './mavlink-adapter-callbacks'
import {
  checkLinkState, requestDataStreams, processInboundFrame, resetOnDisconnect, type FrameHandlerState,
} from './mavlink-adapter-frame-handlers'
import { StatusTextAssembler } from './handlers/info-handlers'
import * as cmds from './mavlink-adapter-commands'
import * as ext from './mavlink-adapter-ext-commands'
import * as prm from './mavlink-adapter-params'
import * as msn from './mavlink-adapter-missions'
import * as logOps from './mavlink-adapter-logs'
import * as ftpOps from './mavlink-adapter-ftp'
import * as ftpWriteOps from './mavlink-adapter-ftp-ops'
import { LinkSet } from './mavlink-adapter-links'
import { CameraDiscovery } from './mavlink-adapter-camera'
import { commandRefusal } from './command-refusal'
import { NO_CAPABILITIES } from './no-capabilities'
import type { MavlinkSigner } from './mavlink-signer'

export class MAVLinkAdapter implements DroneProtocol {
  readonly protocolName = 'mavlink'

  // Internal state
  /** True while this adapter routes link frames into its state machines. */
  private routing = false
  private commandQueue = new CommandQueue(3000)
  /** Every transport reaching this drone, with its parser and signing. */
  private readonly ls = new LinkSet(
    (frame) => { if (this.routing) this.handleFrame(frame) },
    (linkId) => this.handleLinkClose(linkId),
  )
  private _connected = false
  private _disconnected = false
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private linkLostCheckInterval: ReturnType<typeof setInterval> | null = null
  /** Stream-rate re-request triggers (link restored, FC reboot); dropped on disconnect. */
  private streamTriggers: Array<() => void> = []
  /** Last SYSTEM_TIME.time_boot_ms, to spot an FC reboot. */
  private lastBootMs: number | null = null
  private disconnectListeners: Array<() => void> = []

  /** The link outbound frames go through (prefers one that can command). */
  get commandTransport(): Transport | null { return this.ls.commandTransport }

  /**
   * Sign every outbound MAVLink v2 frame with `signer` (and verify inbound
   * signed frames against it), or send unsigned with null. Takes effect on
   * the next frame on every link.
   */
  setSigner(signer: MavlinkSigner | null): void {
    this.ls.setSigner(signer)
  }

  /** Fires once when the last link goes or the adapter is disconnected. */
  onDisconnect(cb: () => void): () => void {
    this.disconnectListeners.push(cb)
    return () => { this.disconnectListeners = this.disconnectListeners.filter((l) => l !== cb) }
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
  private readonly camera = new CameraDiscovery(this.st, (cmd, p, comp) => this.sendCommandLong(cmd, p, undefined, comp))
  /** The last IMAGE_START_CAPTURE sequence number sent (single captures count from 1). */
  private captureSequence = 0

  // ── Connection ─────────────────────────────────────────
  async connect(transport: Transport): Promise<VehicleInfo> {
    this._disconnected = false
    const link = this.ls.attach(transport, transport.type)
    // Route frames for this connection; handleDisconnect stops it. The router
    // is on before the heartbeat wait so nothing arriving with the first
    // heartbeat is lost.
    this.routing = true
    let vehicleInfo: VehicleInfo
    try {
      vehicleInfo = await this.ls.awaitAutopilot(link, 10000, (frame, hb) => {
        const st = this.st
        st.targetSysId = frame.systemId; st.targetCompId = frame.componentId
        st.firmwareHandler = createFirmwareHandler(hb.autopilot, hb.type)
        const info: VehicleInfo = {
          firmwareType: st.firmwareHandler.firmwareType, vehicleClass: st.firmwareHandler.vehicleClass,
          firmwareVersionString: st.firmwareHandler.getFirmwareVersion(),
          systemId: frame.systemId, componentId: frame.componentId,
          autopilotType: hb.autopilot, vehicleType: hb.type,
        }
        st.vehicleInfo = info
        return info
      })
    } catch (err) {
      this.routing = false
      throw err
    }

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
    // Stream rates are requested once per (re)connection, never on a timer:
    // a periodic re-send overrode the operator's SRn_/MAVn_ edits and the
    // agent router's configured rates.
    this.requestStreams()
    this.lastBootMs = null
    this.streamTriggers = [
      this.cbm.onLinkRestored(() => this.requestStreams()),
      this.cbm.onSystemTime(({ timeBootMs }) => {
        // time_boot_ms going backwards means the FC rebooted.
        if (this.lastBootMs !== null && timeBootMs < this.lastBootMs) this.requestStreams()
        this.lastBootMs = timeBootMs
      }),
    ]
    this.st.lastVehicleHeartbeat = Date.now(); this.st.linkIsLost = false
    this.linkLostCheckInterval = setInterval(() => checkLinkState(this.st), 1000)
    this.sendCommandLong(512, [242, 0, 0, 0, 0, 0, 0]).catch(() => {})
    // The EKF origin is sent when it is set; ask once in case that happened
    // before this connection.
    this.sendCommandLong(512, [49, 0, 0, 0, 0, 0, 0]).catch(() => {})
    this.sendCommandLong(512, [148, 0, 0, 0, 0, 0, 0]).catch(() => {})
    // EXTENDED_SYS_STATE (245) at 1 Hz is the flight controller's landed state,
    // which Disarm gates on; a refusal or no answer just leaves it unknown.
    this.sendCommandLong(511, [245, 1_000_000, 0, 0, 0, 0, 0]).catch(() => {})
    this.camera.start()
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
    // Wait for a heartbeat from the SAME sysid
    return this.ls.verifyNewLink(this.ls.attach(transport, transport.type), this.st.targetSysId)
  }

  /** Remove a link by id. If it's the last link, the adapter disconnects. */
  async removeLink(linkId: string): Promise<void> {
    const link = this.ls.links.get(linkId)
    if (!link) return
    this.ls.detach(link)
    if (link.transport.isConnected) {
      try { await link.transport.disconnect() } catch { /* ignore */ }
    }
    if (this.ls.links.size === 0) {
      this.handleDisconnect()
    }
  }

  /** Returns information about all active links for this drone. */
  get linkInfo(): LinkInfo[] { return this.ls.info() }

  /** Called when an individual link's transport closes. */
  private handleLinkClose(linkId: string): void {
    const link = this.ls.links.get(linkId)
    if (!link) return
    this.ls.detach(link)
    if (this.ls.links.size === 0) {
      this.handleDisconnect()
    }
  }

  /** Request telemetry rates; housekeeping, so a send failure is logged, never thrown. */
  private requestStreams(): void {
    try {
      requestDataStreams(this.st)
    } catch (err) {
      console.warn('[MAVLinkAdapter] stream-rate request failed:', err)
    }
  }

  async disconnect(): Promise<void> {
    const links = Array.from(this.ls.links.values())
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
    if (this.linkLostCheckInterval) { clearInterval(this.linkLostCheckInterval); this.linkLostCheckInterval = null }
    for (const off of this.streamTriggers) off()
    this.streamTriggers = []
    this.commandQueue.clear(); this.paramCache.clear(); this.camera.reset()
    this.routing = false
    resetOnDisconnect(this.st, this._ftpCtx)
    // Detach all remaining links
    for (const link of Array.from(this.ls.links.values())) {
      this.ls.detach(link)
    }
    for (const cb of [...this.disconnectListeners]) {
      try { cb() } catch (err) { console.warn('[MAVLinkAdapter] disconnect listener threw', err) }
    }
  }

  /** Every frame the link parser accepts (reassembled, CRC-checked, signature stripped). */
  onMavlinkFrame(callback: (frame: MAVLinkFrame) => void): () => void { return this.ls.listen((frame) => callback(frame)) }

  /** Set to true when the MAVLink Inspector / diagnostics panel is open. */
  diagnosticsEnabled = false

  private handleFrame(frame: MAVLinkFrame): void {
    processInboundFrame(this.st, frame, this.diagnosticsEnabled)
    if (this._connected) this.camera.observe(frame)
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
  async imageStartCapture() { return cmds.cmdImageStartCapture(this.cc, ++this.captureSequence, this.camera.commandCompId) }
  async setCameraZoom(step: 1 | -1) { return cmds.cmdSetCameraZoom(this.cc, step, this.camera.commandCompId) }
  async orbit(radius: number, velocity: number, yawBehavior: number, lat: number, lon: number, alt: number) { return cmds.cmdOrbit(this.cc, radius, velocity, yawBehavior, lat, lon, alt) }
  async setEkfOrigin(lat: number, lon: number, alt: number) { return cmds.cmdSetEkfOrigin(this.cc, lat, lon, alt) }

  private get xc(): ext.ExtCommandContext {
    const { firmwareHandler, targetSysId, targetCompId, sysId, compId } = this.st
    return { firmwareHandler, targetSysId, targetCompId, sysId, compId, linkUp: !!this.ls.primary?.isConnected, sendCommandLong: this.sendCommandLong.bind(this), sendHousekeeping: (d) => this.sendWrapped(d) }
  }

  /** Switch the active EKF source set at runtime (ArduPilot; PX4 resolves `px4-not-supported`). */
  async setEkfSourceSet(sourceSet: 1 | 2 | 3) {
    return ext.setEkfSourceSet(this.xc, sourceSet, () => {
      if (this.px4EkfSourceWarned) return
      this.px4EkfSourceWarned = true
      console.warn('PX4 does not support runtime EKF source-set switching, parameter update plus EKF restart required')
    })
  }
  sendSerialData(t: string) { cmds.cmdSendSerialData(this.cc, t) }
  async enableCanForward(bus: number) { return ext.enableCanForward(this.xc, bus) }
  async actuatorTest(functionCode: number, value: number, timeoutS: number) { return ext.actuatorTest(this.xc, functionCode, value, timeoutS) }
  sendCanFrame(bus: number, id: number, data: Uint8Array): void { ext.sendCanFrame(this.xc, bus, id, data, false) }
  sendCanFdFrame(bus: number, id: number, data: Uint8Array): void { ext.sendCanFrame(this.xc, bus, id, data, true) }

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
  async uploadRallyPoints(pts: RallyPointItem[]) { return msn.uploadRallyPoints(this.st, pts) }
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
  onAccelCalPos = this.cbm.onAccelCalPos; onHomePosition = this.cbm.onHomePosition; onGpsOrigin = this.cbm.onGpsOrigin
  onAutopilotVersion = this.cbm.onAutopilotVersion; onPowerStatus = this.cbm.onPowerStatus
  onDistanceSensor = this.cbm.onDistanceSensor; onFenceStatus = this.cbm.onFenceStatus
  onNavController = this.cbm.onNavController; onScaledImu = this.cbm.onScaledImu
  onScaledPressure = this.cbm.onScaledPressure; onEstimatorStatus = this.cbm.onEstimatorStatus
  onCameraTrigger = this.cbm.onCameraTrigger; onLinkLost = this.cbm.onLinkLost
  onLinkRestored = this.cbm.onLinkRestored; onLocalPosition = this.cbm.onLocalPosition
  onDebug = this.cbm.onDebug; onGimbalAttitude = this.cbm.onGimbalAttitude
  onObstacleDistance = this.cbm.onObstacleDistance; onCameraImageCaptured = this.cbm.onCameraImageCaptured
  onAdsbVehicle = this.cbm.onAdsbVehicle; onCameraInformation = this.cbm.onCameraInformation
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
    return this.st.firmwareHandler?.getCapabilities() ?? NO_CAPABILITIES
  }
  getFirmwareHandler(): FirmwareHandler | null { return this.st.firmwareHandler }
  setDiagnosticsEnabled(enabled: boolean): void { this.diagnosticsEnabled = enabled }
  getCommandQueueSnapshot(): CommandQueueSnapshot { return { pendingCount: this.commandQueue.pendingCount, entries: this.commandQueue.getSnapshot() } }

  /**
   * The command queue's sender. Unlike `sendWrapped` it lets a transport
   * refusal or a dropped link throw, so the queue fails the command at once
   * with the transport's own reason instead of reporting a timeout.
   */
  private readonly sendOrThrow = (d: Uint8Array): void => {
    const t = this.commandTransport
    if (!t?.isConnected) throw new Error('Not connected')
    t.send(d)
  }

  private sendCommandLong(cmd: number, p: [number, number, number, number, number, number, number], timeout?: number, targetComp = this.st.targetCompId): Promise<CommandResult> {
    const refusal = commandRefusal(this.commandTransport)
    if (refusal) return Promise.resolve({ success: false, resultCode: -1, message: refusal })
    const s = this.st
    return this.commandQueue.sendCommand(cmd, p, this.sendOrThrow, s.targetSysId, targetComp, s.sysId, s.compId, timeout)
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
    const refusal = commandRefusal(this.commandTransport)
    if (refusal) return Promise.resolve({ success: false, resultCode: -1, message: refusal })
    const s = this.st
    return this.commandQueue.sendCommandInt(cmd, p, x, y, z, frame, this.sendOrThrow, s.targetSysId, s.targetCompId, s.sysId, s.compId, timeout)
  }

  /** Housekeeping send (heartbeat, CAN frames) through the command link.
   * A transport can throw when it dropped between an isConnected check and
   * the send; swallow + log so a disconnect race never escapes as an
   * uncaught exception. Commands use `sendOrThrow` instead. */
  private sendWrapped(data: Uint8Array): void {
    try {
      this.commandTransport?.send(data)
    } catch (err) {
      console.warn('[MAVLinkAdapter] transport send failed:', err)
    }
  }
}
