/**
 * MAVLink adapter — stateful frame handlers (mission/param/version state machines).
 * @module protocol/mavlink-adapter-frame-handlers
 */

import type { VehicleInfo, ParameterValue, MissionItem } from './types'
import type { MAVLinkFrame } from './mavlink-parser'
import type { CallbackStore } from './mavlink-adapter-callbacks'
import type { ParamContext } from './mavlink-adapter-params'
import type { MissionContext } from './mavlink-adapter-missions'
import {
  handleMissionAckFrame, handleMissionRequestFrame,
  handleMissionCountResponse, handleMissionItemIntResponse,
} from './mission-frame-handlers'
import type { LogContext } from './mavlink-adapter-logs'
import {
  decodeCommandAck, decodeParamValue,
  decodeMissionAck, decodeMissionRequestInt,
  decodeMissionCount, decodeMissionItemInt as decodeMissionItemIntMsg,
  decodeComponentMetadata,
} from './messages'
import { usesBytewiseParamValues } from './param-value-codec'
import { encodeRequestDataStream, encodeCommandLong } from './encoders'
import { useSettingsStore } from '@/stores/settings-store'
import {
  handleAttitude, handleGlobalPosition, handleBattery,
  handleGpsRaw, handleVfrHud, handleRcChannels,
  handleSysStatus, handleRadioStatus, handlePowerStatus,
  handleScaledImu, handleScaledPressure, handleEstimatorStatus, handleLocalPosition,
  handleRawImu, handleRcChannelsRaw, handleRcChannelsOverride, handleAltitude,
} from './handlers/telemetry-handlers'
import {
  handleEkfStatus, handleVibration, handleServoOutput,
  handleWind, handleTerrainReport, handleHomePosition, handleGpsGlobalOrigin,
  handleDistanceSensor, handleFenceStatus, handleNavControllerOutput,
  handleFencePoint, handleMissionCurrent, handleMissionItemReached,
  handleWindCov, handleMissionItemLegacy, handleAdsbVehicle,
} from './handlers/nav-safety-handlers'
import {
  handleMagCalProgress, handleMagCalReport, handleIncomingCommandLong,
} from './handlers/calibration-handlers'
import {
  handleExtendedSysState, handleSystemTime, type StatusTextAssembler,
  handleEvent, handleSerialControl,
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
import { handleLogEntry, handleLogData, cancelLogList, cancelLogDownload } from './mavlink-adapter-logs'
import { handleFileTransferProtocolAck, type FtpContext } from './mavlink-adapter-ftp'
import { handleFtpOpAck, cancelFtpOp } from './mavlink-adapter-ftp-ops'
import { cancelMissionTransfers } from './mavlink-adapter-missions'
import { useDiagnosticsStore } from '@/stores/diagnostics-store'
import type { CommandQueue } from './command-queue'
import { handleHeartbeat } from './heartbeat-source'
import { MSG_NAMES } from './messages/msg-names'

/**
 * The adapter's one mutable protocol state. Frame handlers, the transfer
 * timers and the adapter's own methods all read and write this same object,
 * so a transfer that settles on any path clears the slot every other path
 * sees. It is also the param, mission and log context those modules take.
 */
export interface FrameHandlerState extends ParamContext, MissionContext, LogContext {
  vehicleInfo: VehicleInfo | null
  commandQueue: CommandQueue
  cbs: CallbackStore
  /** Shared FTP context (session state + timers live here). Optional so
   *  lightweight test fixtures need not construct it; always set in production. */
  ftpCtx?: FtpContext
  lastVehicleHeartbeat: number
  linkIsLost: boolean
  HEARTBEAT_TIMEOUT_MS: number
  /** Joins chunked STATUSTEXT sequences; per adapter so partial sequences never mix. */
  statusText: StatusTextAssembler
  /**
   * URI from the last COMPONENT_METADATA (msg 397), PX4 only. Null until
   * received. Optional so lightweight test fixtures need not construct it
   * (same rationale as `ftpCtx`); always set in production.
   */
  componentMetadataUri?: string | null
  /** Home altitude AMSL (m) from the vehicle's last HOME_POSITION; null until one arrives. */
  homeAltitudeAmsl: number | null
}

/**
 * Messages accepted from any source system. RADIO_STATUS comes from the
 * telemetry radio, which has its own sysid (a SiK radio sends as 51), so it
 * describes this link rather than a vehicle.
 *
 * Everything else describes, or drives a state machine for, ONE vehicle. On a
 * multiplexed transport (a ground-station agent relaying two drones, or a SiK
 * mesh) frames from another sysid would otherwise interleave that aircraft's
 * position, attitude and battery into this drone's slice, resolve this
 * drone's promises, or mask its link loss, so they are dropped here.
 */
const ANY_SOURCE_MSG_IDS = new Set([109])

/**
 * Mission-protocol frames carry target_system/target_component: the GCS the
 * vehicle is talking to. On a shared link another GCS's transfer must not
 * drive this adapter's upload or download.
 */
const MISSION_TARGETED_MSG_IDS = new Set([40, 44, 47, 51, 73])

/**
 * True when a frame should be processed for the target vehicle. Accepts a
 * broadcast (systemId 0) or a source whose sysid matches targetSysId.
 * targetSysId defaults to 1 until the connect-time heartbeat lock fires on
 * its own dedicated parser listener (not through this router).
 */
function isFromTargetVehicle(s: FrameHandlerState, frame: MAVLinkFrame): boolean {
  if (frame.systemId === 0) return true
  return frame.systemId === s.targetSysId
}

/**
 * Whether a mission-protocol frame is addressed to this GCS. 0 means "any",
 * the same rule the COMMAND_ACK path applies. Every one of these messages
 * carries target_system at byte 0 or 2 and target_component right after.
 */
function isMissionFrameForUs(s: FrameHandlerState, frame: MAVLinkFrame): boolean {
  let target: { targetSystem: number; targetComponent: number }
  switch (frame.msgId) {
    case 47: target = decodeMissionAck(frame.payload); break
    case 44: target = decodeMissionCount(frame.payload); break
    case 73: target = decodeMissionItemIntMsg(frame.payload); break
    default: target = decodeMissionRequestInt(frame.payload) // 40 and 51 share the layout
  }
  if (target.targetSystem !== 0 && target.targetSystem !== s.sysId) return false
  if (target.targetComponent !== 0 && target.targetComponent !== s.compId) return false
  return true
}

export function routeFrame(s: FrameHandlerState, frame: MAVLinkFrame, p: DataView): void {
  const c = s.cbs
  if (!ANY_SOURCE_MSG_IDS.has(frame.msgId) && !isFromTargetVehicle(s, frame)) return
  if (MISSION_TARGETED_MSG_IDS.has(frame.msgId) && !isMissionFrameForUs(s, frame)) return
  switch (frame.msgId) {
    case 0:   handleHeartbeat(s, frame); break
    // PARAM_VALUE and AUTOPILOT_VERSION are broadcast, and a camera, gimbal or
    // companion on the vehicle's system id answers other GCSs with its own.
    // Only the locked autopilot component may feed the autopilot's parameter
    // download and vehicle identity.
    case 22:  if (frame.componentId === s.targetCompId) handleParamValueFrame(s, frame); break
    case 77:  { const ack = decodeCommandAck(frame.payload); s.commandQueue.handleAck(ack.command, ack.result, frame.systemId, ack.targetSystem, ack.targetComponent); break }
    case 40:  handleMissionRequestFrame(s, frame); break
    case 44:  handleMissionCountResponse(s, frame); break
    case 47:  handleMissionAckFrame(s, frame); break
    case 51:  handleMissionRequestFrame(s, frame); break
    case 73:  handleMissionItemIntResponse(s, frame); break
    case 110: if (s.ftpCtx) { handleFileTransferProtocolAck(s.ftpCtx, frame); handleFtpOpAck(s.ftpCtx, frame) } break
    case 118: handleLogEntry(s, frame); break
    case 120: handleLogData(s, frame); break
    case 148: if (frame.componentId === s.targetCompId) handleAutopilotVersionFrame(s, frame); break
    case 397: handleComponentMetadataFrame(s, frame); break
    case 1:   handleSysStatus(p, c.sysStatusCallbacks); break
    case 24:  handleGpsRaw(p, c.gpsCallbacks); break
    case 26:  handleScaledImu(p, c.scaledImuCallbacks, 0); break
    case 27:  handleRawImu(p, c.rawImuCallbacks); break
    case 116: handleScaledImu(p, c.scaledImuCallbacks, 1); break // SCALED_IMU2
    case 129: handleScaledImu(p, c.scaledImuCallbacks, 2); break // SCALED_IMU3
    case 29:  handleScaledPressure(p, c.scaledPressureCallbacks); break
    case 30:  handleAttitude(p, c.attitudeCallbacks); break
    case 32:  handleLocalPosition(p, c.localPositionCallbacks); break
    case 33:  handleGlobalPosition(p, c.positionCallbacks); break
    case 35:  handleRcChannelsRaw(p, c.rcChannelsRawCallbacks); break
    case 65:  handleRcChannels(p, c.rcCallbacks); break
    case 70:  handleRcChannelsOverride(p, c.rcChannelsOverrideCallbacks); break
    case 74:  handleVfrHud(p, c.vfrCallbacks); break
    case 109: handleRadioStatus(p, c.radioCallbacks, frame.systemId); break
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
    case 242: s.homeAltitudeAmsl = handleHomePosition(p, c.homePositionCallbacks); break
    case 49:  handleGpsGlobalOrigin(p, c.gpsOriginCallbacks); break
    case 193: handleEkfStatus(p, c.ekfCallbacks); break
    case 230: handleEstimatorStatus(p, c.estimatorStatusCallbacks); break
    case 76:  handleIncomingCommandLong(p, c.accelCalPosCallbacks); break
    case 191: handleMagCalProgress(p, c.magCalProgressCallbacks); break
    case 192: handleMagCalReport(p, c.magCalReportCallbacks); break
    case 2:   handleSystemTime(p, c.systemTimeCallbacks); break
    case 126: handleSerialControl(p, c.serialDataCallbacks); break
    case 245: handleExtendedSysState(p, c.extendedSysStateCallbacks); break
    case 253: s.statusText.push(frame, p, c.statusTextCallbacks); break
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
    case 246: handleAdsbVehicle(p, c.adsbVehicleCallbacks); break
    case 386: handleCanFrame(p, c.canFrameCallbacks); break
    case 387: handleCanFdFrame(p, c.canFdFrameCallbacks); break
    case 100: handleOpticalFlow(p, c.opticalFlowCallbacks); break
    case 106: handleOpticalFlowRad(p, c.opticalFlowRadCallbacks); break
    case 102: handleVisionPositionEstimate(p, c.visionPositionEstimateCallbacks); break
    case 331: handleOdometry(p, c.odometryCallbacks); break
    case 11011: handleVisionPositionDelta(p, c.visionPositionDeltaCallbacks); break
  }
}

/**
 * Route one inbound frame, timing it for the diagnostics store. Per-frame
 * logging (and the parse-rate sample) runs only while a diagnostics surface
 * is mounted; `includeHex` adds the payload hex for the Frames tab.
 */
export function processInboundFrame(s: FrameHandlerState, frame: MAVLinkFrame, includeHex: boolean): void {
  const startTime = performance.now()
  const diag = useDiagnosticsStore.getState()
  const msgName = MSG_NAMES[frame.msgId] ?? `MSG_${frame.msgId}`
  if (diag.diagnosticsSubscribed > 0) {
    diag.recordParseEvent()
    let rawHex: string | undefined
    if (includeHex) {
      const pb = new Uint8Array(frame.payload.buffer, frame.payload.byteOffset, frame.payload.byteLength)
      rawHex = Array.from(pb.slice(0, 32)).map((b) => b.toString(16).padStart(2, '0')).join(' ') + (pb.length > 32 ? ' ...' : '')
    }
    diag.logMessage(frame.msgId, msgName, 'in', frame.payload.byteLength, rawHex)
  }
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

/** Settle every in-flight transfer and clear per-connection state when the last link goes. */
export function resetOnDisconnect(s: FrameHandlerState, ftpCtx: FtpContext): void {
  s.statusText.clear(); s.downloadedParamNames = null
  s.componentMetadataUri = null; s.homeAltitudeAmsl = null
  cancelLogList(s, 'Disconnected during log list')
  if (s.logDataDownload) cancelLogDownload(s, 'Disconnected during log download')
  const ftp = ftpCtx.ftpDownload
  if (ftp) {
    clearTimeout(ftp.inactivityTimer ?? undefined); clearTimeout(ftp.hardTimer)
    ftp.reject(new Error('Disconnected during FTP download')); ftpCtx.ftpDownload = null
  }
  finishParamDownload(s, new Error('Disconnected during parameter download'))
  cancelMissionTransfers(s, 'Disconnected during mission transfer')
  cancelFtpOp(ftpCtx, 'Disconnected during FTP operation')
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
  const pv = decodeParamValue(frame.payload, usesBytewiseParamValues(s.firmwareHandler?.firmwareType))
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
      finishParamDownload(s)
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

function handleAutopilotVersionFrame(s: FrameHandlerState, frame: MAVLinkFrame): void {
  const data = handleAutopilotVersionMsg(frame.payload, s.cbs.autopilotVersionCallbacks, s.firmwareHandler?.firmwareType)
  if (s.vehicleInfo) {
    const major = (data.flightSwVersion >> 24) & 0xff
    const minor = (data.flightSwVersion >> 16) & 0xff
    const patch = (data.flightSwVersion >> 8) & 0xff
    s.vehicleInfo = {
      ...s.vehicleInfo,
      firmwareVersionString: `${major}.${minor}.${patch}`,
      boardId: data.boardId,
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
  // The operator (or the agent's router) owns the stream rates: never send.
  if (!useSettingsStore.getState().gcsManagesTelemetryRates) return
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
