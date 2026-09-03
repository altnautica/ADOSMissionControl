/**
 * MAVLink adapter — stateful frame handlers (mission/param/version state machines).
 * @module protocol/mavlink-adapter-frame-handlers
 */

import type { VehicleInfo, ParameterValue, CommandResult, MissionItem, FirmwareHandler, ParameterCallback } from './types'
import type { MAVLinkFrame } from './mavlink-parser'
import type { CallbackStore } from './mavlink-adapter-callbacks'
import type { ParamDownloadState, ParamCacheEntry } from './mavlink-adapter-params'
import type { MissionUploadState, MissionDownloadState, RallyUploadState, RallyDownloadState, FenceUploadState, FenceDownloadState } from './mavlink-adapter-missions'
import { decodeFenceMissionItems } from './mavlink-adapter-missions'
import type { LogListState, LogDataState } from './mavlink-adapter-logs'
import {
  decodeHeartbeat, decodeCommandAck, decodeParamValue,
  decodeMissionAck, decodeMissionRequestInt,
  decodeMissionCount, decodeMissionItemInt as decodeMissionItemIntMsg,
  decodeComponentMetadata,
} from './mavlink-messages'
import {
  encodeMissionItemInt, encodeMissionRequestInt, encodeMissionAck,
  encodeRequestDataStream, encodeCommandLong,
} from './mavlink-encoder'
import {
  handleAttitude, handleGlobalPosition, handleBattery,
  handleGpsRaw, handleVfrHud, handleRcChannels,
  handleSysStatus, handleRadioStatus, handlePowerStatus,
  handleScaledImu, handleScaledPressure, handleEstimatorStatus, handleLocalPosition,
  handleRawImu, handleRcChannelsRaw, handleRcChannelsOverride, handleAltitude,
} from './handlers/telemetry-handlers'
import {
  handleEkfStatus, handleVibration, handleServoOutput,
  handleWind, handleTerrainReport, handleHomePosition,
  handleDistanceSensor, handleFenceStatus, handleNavControllerOutput,
  handleFencePoint, handleMissionCurrent, handleMissionItemReached,
  handleWindCov, handleMissionItemLegacy,
} from './handlers/nav-safety-handlers'
import {
  handleMagCalProgress, handleMagCalReport, handleIncomingCommandLong,
} from './handlers/calibration-handlers'
import {
  handleExtendedSysState, handleSystemTime,
  handleStatusText, handleEvent, handleSerialControl,
  handleAutopilotVersion as handleAutopilotVersionMsg,
} from './handlers/info-handlers'
import {
  handleNamedValueFloat, handleNamedValueInt, handleDebugValue,
  handleCameraTrigger, handleCameraImageCaptured, handleGimbalAttitude, handleObstacleDistance,
  handleAisVessel, handleGimbalManagerInfo, handleGimbalManagerStatus,
} from './handlers/debug-handlers'
import { handleCanFrame, handleCanFdFrame } from './handlers/can-handlers'
import {
  handleOpticalFlow, handleOpticalFlowRad, handleOdometry,
  handleVisionPositionEstimate, handleVisionPositionDelta,
} from './handlers/vision-handlers'
import { finishParamDownload } from './mavlink-adapter-params'
import { handleLogEntry, handleLogData } from './mavlink-adapter-logs'
import { handleFileTransferProtocolAck, type FtpContext } from './mavlink-adapter-ftp'
import { handleFtpOpAck } from './mavlink-adapter-ftp-ops'
import type { Transport } from './types'
import type { CommandQueue } from './command-queue'

/** Shared adapter state accessed by frame handlers. */
export interface FrameHandlerState {
  transport: Transport | null
  firmwareHandler: FirmwareHandler | null
  vehicleInfo: VehicleInfo | null
  targetSysId: number
  targetCompId: number
  sysId: number
  compId: number
  commandQueue: CommandQueue
  cbs: CallbackStore
  paramCache: Map<string, ParamCacheEntry>
  parameterDownload: ParamDownloadState | null
  /** Names from the last COMPLETE full param download (see ParamContext). */
  downloadedParamNames: Set<string> | null
  missionUpload: MissionUploadState | null
  missionDownload: MissionDownloadState | null
  rallyUpload: RallyUploadState | null
  rallyDownload: RallyDownloadState | null
  fenceUpload: FenceUploadState | null
  fenceDownload: FenceDownloadState | null
  logListDownload: LogListState | null
  logDataDownload: LogDataState | null
  /** Shared FTP context (session state + timers live here). Optional so
   *  lightweight test fixtures need not construct it; always set in production. */
  ftpCtx?: FtpContext
  lastVehicleHeartbeat: number
  linkIsLost: boolean
  HEARTBEAT_TIMEOUT_MS: number
  /**
   * URI from the last COMPONENT_METADATA (msg 397), PX4 only. Null until
   * received. Optional so lightweight test fixtures need not construct it
   * (same rationale as `ftpCtx`); always set in production.
   */
  componentMetadataUri?: string | null
}

/**
 * Stateful messages that drive this adapter's mission/param/command/heartbeat
 * state machines. A frame of one of these ids that originates from a different
 * vehicle (co-channel on a multiplexed transport) must not resolve this drone's
 * promises or mask its link loss, so it is dropped before reaching the handler.
 * Telemetry messages stay permissive (they are display-only).
 */
const STATEFUL_MSG_IDS = new Set([0, 22, 40, 44, 47, 51, 73, 77, 110, 118, 120, 148, 397])

/**
 * True when a stateful frame should be processed for the target vehicle.
 * Accepts a broadcast (systemId 0) or a source whose sysid matches
 * targetSysId. targetSysId defaults to 1 until the connect-time heartbeat
 * lock fires on its own dedicated parser listener (not through this router),
 * so stateful subscribers are not yet attached during that pre-lock window.
 */
function isFromTargetVehicle(s: FrameHandlerState, frame: MAVLinkFrame): boolean {
  if (frame.systemId === 0) return true
  return frame.systemId === s.targetSysId
}

export function routeFrame(s: FrameHandlerState, frame: MAVLinkFrame, p: DataView): void {
  const c = s.cbs
  if (STATEFUL_MSG_IDS.has(frame.msgId) && !isFromTargetVehicle(s, frame)) return
  switch (frame.msgId) {
    case 0:   handleHeartbeat(s, frame); break
    case 22:  handleParamValueFrame(s, frame); break
    case 77:  { const ack = decodeCommandAck(frame.payload); s.commandQueue.handleAck(ack.command, ack.result, frame.systemId); break }
    case 40:  handleMissionRequestFrame(s, frame); break
    case 44:  handleMissionCountResponse(s, frame); break
    case 47:  handleMissionAckFrame(s, frame); break
    case 51:  handleMissionRequestFrame(s, frame); break
    case 73:  handleMissionItemIntResponse(s, frame); break
    case 110: if (s.ftpCtx) { handleFileTransferProtocolAck(s.ftpCtx, frame); handleFtpOpAck(s.ftpCtx, frame) } break
    case 118: handleLogEntry({ transport: s.transport, targetSysId: s.targetSysId, targetCompId: s.targetCompId, sysId: s.sysId, compId: s.compId, logListDownload: s.logListDownload, logDataDownload: s.logDataDownload }, frame); break
    case 120: handleLogData({ transport: s.transport, targetSysId: s.targetSysId, targetCompId: s.targetCompId, sysId: s.sysId, compId: s.compId, logListDownload: s.logListDownload, logDataDownload: s.logDataDownload }, frame); break
    case 148: handleAutopilotVersionFrame(s, frame); break
    case 397: handleComponentMetadataFrame(s, frame); break
    case 1:   handleSysStatus(p, c.sysStatusCallbacks); break
    case 24:  handleGpsRaw(p, c.gpsCallbacks); break
    case 26:  handleScaledImu(p, c.scaledImuCallbacks); break
    case 27:  handleRawImu(p, c.rawImuCallbacks); break
    case 116: handleScaledImu(p, c.scaledImuCallbacks); break // SCALED_IMU2
    case 129: handleScaledImu(p, c.scaledImuCallbacks); break // SCALED_IMU3
    case 29:  handleScaledPressure(p, c.scaledPressureCallbacks); break
    case 30:  handleAttitude(p, c.attitudeCallbacks); break
    case 32:  handleLocalPosition(p, c.localPositionCallbacks); break
    case 33:  handleGlobalPosition(p, c.positionCallbacks); break
    case 35:  handleRcChannelsRaw(p, c.rcChannelsRawCallbacks); break
    case 65:  handleRcChannels(p, c.rcCallbacks); break
    case 70:  handleRcChannelsOverride(p, c.rcChannelsOverrideCallbacks); break
    case 74:  handleVfrHud(p, c.vfrCallbacks); break
    case 109: handleRadioStatus(p, c.radioCallbacks); break
    case 125: handlePowerStatus(p, c.powerStatusCallbacks); break
    case 141: handleAltitude(p, c.altitudeCallbacks); break
    case 147: handleBattery(p, c.batteryCallbacks); break
    case 36:  handleServoOutput(p, c.servoOutputCallbacks); break
    case 39:  handleMissionItemLegacy(p, c.missionItemCallbacks); break
    case 42:  handleMissionCurrent(p, c.missionProgressCallbacks); break
    case 46:  handleMissionItemReached(p, c.missionProgressCallbacks); break
    case 62:  handleNavControllerOutput(p, c.navControllerCallbacks); break
    case 132: handleDistanceSensor(p, c.distanceSensorCallbacks); break
    case 136: handleTerrainReport(p, c.terrainCallbacks); break
    case 160: handleFencePoint(p, c.fencePointCallbacks); break
    case 162: handleFenceStatus(p, c.fenceStatusCallbacks); break
    case 168: handleWind(p, c.windCallbacks); break
    case 231: handleWindCov(p, c.windCovCallbacks); break
    case 241: handleVibration(p, c.vibrationCallbacks); break
    case 242: handleHomePosition(p, c.homePositionCallbacks); break
    case 193: handleEkfStatus(p, c.ekfCallbacks); break
    case 230: handleEstimatorStatus(p, c.estimatorStatusCallbacks); break
    case 76:  handleIncomingCommandLong(p, c.accelCalPosCallbacks); break
    case 191: handleMagCalProgress(p, c.magCalProgressCallbacks); break
    case 192: handleMagCalReport(p, c.magCalReportCallbacks); break
    case 2:   handleSystemTime(p, c.systemTimeCallbacks); break
    case 126: handleSerialControl(p, c.serialDataCallbacks); break
    case 245: handleExtendedSysState(p, c.extendedSysStateCallbacks); break
    case 253: handleStatusText(p, c.statusTextCallbacks); break
    case 410: handleEvent(p, c.eventCallbacks); break
    case 112: handleCameraTrigger(p, c.cameraTriggerCallbacks); break
    case 251: handleNamedValueFloat(p, c.debugCallbacks); break
    case 252: handleNamedValueInt(p, c.debugCallbacks); break
    case 254: handleDebugValue(p, c.debugCallbacks); break
    case 301: handleAisVessel(p, c.aisVesselCallbacks); break
    case 263: handleCameraImageCaptured(p, c.cameraImageCallbacks); break
    case 285: handleGimbalAttitude(p, c.gimbalAttitudeCallbacks); break
    case 280: handleGimbalManagerInfo(p, c.gimbalManagerInfoCallbacks); break
    case 281: handleGimbalManagerStatus(p, c.gimbalManagerStatusCallbacks); break
    case 330: handleObstacleDistance(p, c.obstacleDistanceCallbacks); break
    case 386: handleCanFrame(p, c.canFrameCallbacks); break
    case 387: handleCanFdFrame(p, c.canFdFrameCallbacks); break
    case 100: handleOpticalFlow(p, c.opticalFlowCallbacks); break
    case 106: handleOpticalFlowRad(p, c.opticalFlowRadCallbacks); break
    case 102: handleVisionPositionEstimate(p, c.visionPositionEstimateCallbacks); break
    case 331: handleOdometry(p, c.odometryCallbacks); break
    case 11011: handleVisionPositionDelta(p, c.visionPositionDeltaCallbacks); break
  }
}

function handleHeartbeat(s: FrameHandlerState, frame: MAVLinkFrame): void {
  const hb = decodeHeartbeat(frame.payload)
  if (hb.type === 6) return
  s.lastVehicleHeartbeat = Date.now()
  const armed = (hb.baseMode & 0x80) !== 0
  const mode = s.firmwareHandler?.decodeFlightMode(hb.customMode) ?? 'UNKNOWN'
  for (const cb of s.cbs.heartbeatCallbacks) {
    cb({ armed, mode, systemStatus: hb.systemStatus, vehicleInfo: s.vehicleInfo! })
  }
}

export function checkLinkState(s: FrameHandlerState): void {
  const elapsed = Date.now() - s.lastVehicleHeartbeat
  if (elapsed > s.HEARTBEAT_TIMEOUT_MS && !s.linkIsLost) {
    s.linkIsLost = true
    for (const cb of s.cbs.linkLostCallbacks) cb()
  } else if (elapsed <= s.HEARTBEAT_TIMEOUT_MS && s.linkIsLost) {
    s.linkIsLost = false
    for (const cb of s.cbs.linkRestoredCallbacks) cb()
  }
}

function handleParamValueFrame(s: FrameHandlerState, frame: MAVLinkFrame): void {
  const pv = decodeParamValue(frame.payload)
  const canonicalName = s.firmwareHandler?.reverseMapParameterName(pv.paramId) ?? pv.paramId
  const param: ParameterValue = {
    name: canonicalName, value: pv.paramValue, type: pv.paramType,
    index: pv.paramIndex, count: pv.paramCount,
  }
  for (const cb of s.cbs.parameterCallbacks) cb(param)
  s.paramCache.set(canonicalName, { value: pv.paramValue, timestamp: Date.now(), type: pv.paramType, index: pv.paramIndex, count: pv.paramCount })
  // MAVLink's PARAM_VALUE carries no request-correlation id, so a frame from
  // an unrelated exchange (a stray targeted read, or a corrupted/malformed
  // frame off the lossy relay's batch splitter) is indistinguishable, at this
  // layer, from a genuine bulk-list entry. A real indexed parameter always
  // satisfies 0 <= index < count; reject anything that doesn't before it can
  // feed or complete a bulk download — seen live: a single malformed
  // `index=65535,count=1` frame set `total=1` and immediately "completed" a
  // download that had barely started, discarding all real progress. The
  // targeted-read caller (paramCache/parameterCallbacks above) still resolves
  // normally either way.
  const indexIsValid = pv.paramIndex >= 0 && pv.paramIndex < pv.paramCount
  if (s.parameterDownload && indexIsValid) {
    s.parameterDownload.total = pv.paramCount
    const sizeBefore = s.parameterDownload.params.size
    s.parameterDownload.params.set(pv.paramIndex, param)
    const grew = s.parameterDownload.params.size > sizeBefore
    if (s.parameterDownload.params.size >= pv.paramCount) {
      // Authoritative completion — every param the board reports has arrived.
      // Snapshot the exact name set so getParameter can fast-fail reads for
      // params this board does not have (e.g. an absent SERIALn on a board with
      // fewer UARTs) instead of waiting out a doomed PARAM_REQUEST_READ.
      s.downloadedParamNames = new Set(
        Array.from(s.parameterDownload.params.values(), (p) => p.name),
      )
      const ctx = { transport: s.transport, firmwareHandler: s.firmwareHandler, targetSysId: s.targetSysId, targetCompId: s.targetCompId, sysId: s.sysId, compId: s.compId, paramCache: s.paramCache, PARAM_CACHE_TTL_MS: 300000, parameterDownload: s.parameterDownload, downloadedParamNames: s.downloadedParamNames, onParameter: (() => () => {}) as (cb: ParameterCallback) => () => void }
      finishParamDownload(ctx)
      s.parameterDownload = ctx.parameterDownload
      return
    }
    // Only a genuinely NEW index resets the inactivity timer. A duplicate or
    // retransmitted frame for an index already collected still lands here —
    // routine on a lossy relay — and must NOT count as progress: resetting on
    // every arrival meant a steady trickle of duplicates kept deferring the 5s
    // silence window forever, so the retry-missing-indices fallback below
    // never got a chance to actively re-request what was genuinely still
    // missing. The download would sit at a fixed count indefinitely instead
    // of recovering.
    if (grew) {
      s.parameterDownload.resetInactivityTimer()
    }
  }
}

function handleMissionAckFrame(s: FrameHandlerState, frame: MAVLinkFrame): void {
  const ack = decodeMissionAck(frame.payload)
  if (ack.missionType === 2 && s.rallyUpload) {
    clearTimeout(s.rallyUpload.timer)
    s.rallyUpload.resolve({
      success: ack.type === 0, resultCode: ack.type,
      message: ack.type === 0 ? 'Rally points accepted' : `Rally points rejected: type ${ack.type}`,
    })
    s.rallyUpload = null
    return
  }
  if (ack.missionType === 1 && s.fenceUpload) {
    clearTimeout(s.fenceUpload.timer)
    s.fenceUpload.resolve({
      success: ack.type === 0, resultCode: ack.type,
      message: ack.type === 0 ? 'Fence accepted' : `Fence rejected: type ${ack.type}`,
    })
    s.fenceUpload = null
    return
  }
  if (s.missionUpload) {
    clearTimeout(s.missionUpload.timer)
    s.missionUpload.resolve({
      success: ack.type === 0, resultCode: ack.type,
      message: ack.type === 0 ? 'Mission accepted' : `Mission rejected: type ${ack.type}`,
    })
    s.missionUpload = null
  }
}

function handleMissionRequestFrame(s: FrameHandlerState, frame: MAVLinkFrame): void {
  const req = decodeMissionRequestInt(frame.payload)
  if (req.missionType === 2 && s.rallyUpload && req.seq < s.rallyUpload.items.length) {
    const pt = s.rallyUpload.items[req.seq]
    s.transport?.send(encodeMissionItemInt(
      s.targetSysId, s.targetCompId, req.seq, 6, 5100, 0, 0,
      0, 0, 0, 0, Math.round(pt.lat * 1e7), Math.round(pt.lon * 1e7), pt.alt,
      s.sysId, s.compId, 2,
    ))
    return
  }
  if (req.missionType === 1 && s.fenceUpload && req.seq < s.fenceUpload.items.length) {
    const fi = s.fenceUpload.items[req.seq]
    s.transport?.send(encodeMissionItemInt(
      s.targetSysId, s.targetCompId, fi.seq, fi.frame, fi.command, 0, 1,
      fi.param1, fi.param2, 0, 0, fi.x, fi.y, fi.z,
      s.sysId, s.compId, 1,
    ))
    return
  }
  if (s.missionUpload && req.seq < s.missionUpload.items.length) {
    const item = s.missionUpload.items[req.seq]
    s.transport?.send(encodeMissionItemInt(
      s.targetSysId, s.targetCompId,
      item.seq, item.frame, item.command, item.current, item.autocontinue,
      item.param1, item.param2, item.param3, item.param4,
      item.x, item.y, item.z, s.sysId, s.compId,
    ))
  }
}

function handleMissionCountResponse(s: FrameHandlerState, frame: MAVLinkFrame): void {
  const data = decodeMissionCount(frame.payload)
  if (data.missionType === 2 && s.rallyDownload) {
    s.rallyDownload.total = data.count
    if (data.count === 0) { clearTimeout(s.rallyDownload.timer); s.rallyDownload.resolve([]); s.rallyDownload = null; return }
    s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId, 2))
    return
  }
  if (data.missionType === 1 && s.fenceDownload) {
    s.fenceDownload.total = data.count
    if (data.count === 0) { clearTimeout(s.fenceDownload.timer); s.fenceDownload.resolve([]); s.fenceDownload = null; return }
    s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId, 1))
    return
  }
  if (!s.missionDownload) return
  s.missionDownload.total = data.count
  if (data.count === 0) { clearTimeout(s.missionDownload.timer); s.missionDownload.resolve([]); s.missionDownload = null; return }
  s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId))
}

function handleMissionItemIntResponse(s: FrameHandlerState, frame: MAVLinkFrame): void {
  const data = decodeMissionItemIntMsg(frame.payload)
  if (data.missionType === 2 && s.rallyDownload) {
    s.rallyDownload.items.set(data.seq, { lat: data.x / 1e7, lon: data.y / 1e7, alt: data.z })
    if (s.rallyDownload.items.size >= s.rallyDownload.total) {
      clearTimeout(s.rallyDownload.timer)
      const items = Array.from(s.rallyDownload.items.entries()).sort((a, b) => a[0] - b[0]).map(([, pt]) => pt)
      s.transport?.send(encodeMissionAck(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId, 2))
      s.rallyDownload.resolve(items); s.rallyDownload = null
    } else {
      s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, data.seq + 1, s.sysId, s.compId, 2))
    }
    return
  }
  if (data.missionType === 1 && s.fenceDownload) {
    s.fenceDownload.items.set(data.seq, {
      seq: data.seq, frame: data.frame, command: data.command,
      param1: data.param1, param2: data.param2, x: data.x, y: data.y, z: data.z,
    })
    if (s.fenceDownload.items.size >= s.fenceDownload.total) {
      clearTimeout(s.fenceDownload.timer)
      const elements = decodeFenceMissionItems(Array.from(s.fenceDownload.items.values()))
      s.transport?.send(encodeMissionAck(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId, 1))
      s.fenceDownload.resolve(elements); s.fenceDownload = null
    } else {
      s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, data.seq + 1, s.sysId, s.compId, 1))
    }
    return
  }
  if (!s.missionDownload) return
  const item: MissionItem = {
    seq: data.seq, frame: data.frame, command: data.command,
    current: data.current, autocontinue: data.autocontinue,
    param1: data.param1, param2: data.param2, param3: data.param3, param4: data.param4,
    x: data.x, y: data.y, z: data.z,
  }
  s.missionDownload.items.set(data.seq, item)
  if (s.missionDownload.items.size >= s.missionDownload.total) {
    clearTimeout(s.missionDownload.timer)
    const items = Array.from(s.missionDownload.items.values()).sort((a, b) => a.seq - b.seq)
    s.transport?.send(encodeMissionAck(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId))
    s.missionDownload.resolve(items); s.missionDownload = null
  } else {
    s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, data.seq + 1, s.sysId, s.compId))
  }
}

function handleAutopilotVersionFrame(s: FrameHandlerState, frame: MAVLinkFrame): void {
  const data = handleAutopilotVersionMsg(frame.payload, s.cbs.autopilotVersionCallbacks)
  if (s.vehicleInfo) {
    const major = (data.flightSwVersion >> 24) & 0xff
    const minor = (data.flightSwVersion >> 16) & 0xff
    const patch = (data.flightSwVersion >> 8) & 0xff
    s.vehicleInfo = {
      ...s.vehicleInfo,
      firmwareVersionString: `${major}.${minor}.${patch}`,
      boardId: data.boardVersion,
    }
  }
}

function handleComponentMetadataFrame(s: FrameHandlerState, frame: MAVLinkFrame): void {
  const data = decodeComponentMetadata(frame.payload)
  if (data.uri) s.componentMetadataUri = data.uri
}

/** PX4 telemetry the GCS decoders consume, as `[msgId, hz]`. PX4 ignores the
 *  legacy REQUEST_DATA_STREAM and drives per-message rates via
 *  SET_MESSAGE_INTERVAL (COMMAND_LONG 511), so request each one explicitly. */
const PX4_STREAM_RATES: [number, number][] = [
  [30, 10], // ATTITUDE
  [33, 5], // GLOBAL_POSITION_INT
  [74, 4], // VFR_HUD
  [65, 4], // RC_CHANNELS
  [36, 4], // SERVO_OUTPUT_RAW
  [141, 4], // ALTITUDE
  [1, 2], // SYS_STATUS
  [24, 2], // GPS_RAW_INT
  [147, 1], // BATTERY_STATUS
  [230, 1], // ESTIMATOR_STATUS
  [241, 1], // VIBRATION
  [245, 1], // EXTENDED_SYS_STATE
]

const MAV_CMD_SET_MESSAGE_INTERVAL = 511

export function requestDataStreams(s: Pick<FrameHandlerState, 'transport' | 'firmwareHandler' | 'targetSysId' | 'targetCompId' | 'sysId' | 'compId'>): void {
  // Housekeeping, not an operator action: nothing awaits these and the vehicle
  // streams on its defaults without them. On a receive-only link they cannot be
  // delivered, so skip rather than send — the transport refuses a write it
  // cannot carry, and turning that refusal into a thrown error here would take
  // down a session that is still perfectly good for telemetry.
  if (!s.transport?.isConnected || !s.transport.canCommand) return
  // PX4 uses per-message SET_MESSAGE_INTERVAL, not the legacy REQUEST_DATA_STREAM.
  if (s.firmwareHandler?.firmwareType === 'px4') {
    for (const [msgId, hz] of PX4_STREAM_RATES) {
      const intervalUs = Math.round(1e6 / hz)
      s.transport.send(encodeCommandLong(
        s.targetSysId, s.targetCompId, MAV_CMD_SET_MESSAGE_INTERVAL,
        msgId, intervalUs, 0, 0, 0, 0, 0, s.sysId, s.compId,
      ))
    }
    return
  }
  const streams: [number, number][] = [
    [10, 10], [6, 5], [11, 4], [2, 2], [12, 2], [3, 2], [1, 2],
  ]
  for (const [streamId, rate] of streams) {
    s.transport.send(encodeRequestDataStream(
      s.targetSysId, s.targetCompId, streamId, rate, 1, s.sysId, s.compId,
    ))
  }
}

/** Diagnostic message name lookup. */
export const MSG_NAMES: Record<number, string> = {
  0: 'HEARTBEAT', 1: 'SYS_STATUS', 2: 'SYSTEM_TIME', 22: 'PARAM_VALUE', 24: 'GPS_RAW_INT', 26: 'SCALED_IMU', 27: 'RAW_IMU', 29: 'SCALED_PRESSURE',
  30: 'ATTITUDE', 32: 'LOCAL_POSITION_NED', 33: 'GLOBAL_POSITION_INT', 35: 'RC_CHANNELS_RAW', 36: 'SERVO_OUTPUT_RAW', 39: 'MISSION_ITEM',
  40: 'MISSION_REQUEST', 42: 'MISSION_CURRENT', 44: 'MISSION_COUNT', 46: 'MISSION_ITEM_REACHED', 47: 'MISSION_ACK', 51: 'MISSION_REQUEST_INT', 62: 'NAV_CONTROLLER_OUTPUT',
  65: 'RC_CHANNELS', 70: 'RC_CHANNELS_OVERRIDE', 73: 'MISSION_ITEM_INT', 74: 'VFR_HUD', 76: 'COMMAND_LONG', 77: 'COMMAND_ACK', 109: 'RADIO_STATUS',
  110: 'FILE_TRANSFER_PROTOCOL', 112: 'CAMERA_TRIGGER', 118: 'LOG_ENTRY', 120: 'LOG_DATA', 125: 'POWER_STATUS', 126: 'SERIAL_CONTROL', 132: 'DISTANCE_SENSOR', 136: 'TERRAIN_REPORT',
  141: 'ALTITUDE', 147: 'BATTERY_STATUS', 148: 'AUTOPILOT_VERSION', 160: 'FENCE_POINT', 162: 'FENCE_STATUS', 168: 'WIND', 191: 'MAG_CAL_PROGRESS',
  192: 'MAG_CAL_REPORT', 193: 'EKF_STATUS_REPORT', 230: 'ESTIMATOR_STATUS', 231: 'WIND_COV', 241: 'VIBRATION', 242: 'HOME_POSITION', 245: 'EXTENDED_SYS_STATE',
  246: 'ADSB_VEHICLE', 251: 'NAMED_VALUE_FLOAT', 252: 'NAMED_VALUE_INT', 253: 'STATUSTEXT', 254: 'DEBUG', 263: 'CAMERA_IMAGE_CAPTURED',
  280: 'GIMBAL_MANAGER_INFORMATION', 281: 'GIMBAL_MANAGER_STATUS', 284: 'GIMBAL_DEVICE_SET_ATTITUDE', 285: 'GIMBAL_DEVICE_ATTITUDE_STATUS',
  286: 'AUTOPILOT_STATE_FOR_GIMBAL_DEVICE', 301: 'AIS_VESSEL', 330: 'OBSTACLE_DISTANCE', 335: 'ISBD_LINK_STATUS',
  100: 'OPTICAL_FLOW', 102: 'VISION_POSITION_ESTIMATE', 106: 'OPTICAL_FLOW_RAD', 331: 'ODOMETRY', 11011: 'VISION_POSITION_DELTA',
  386: 'CAN_FRAME', 387: 'CANFD_FRAME', 388: 'CAN_FILTER_MODIFY', 397: 'COMPONENT_METADATA', 410: 'EVENT',
}
