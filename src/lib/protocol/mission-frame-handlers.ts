/**
 * MAVLink adapter — mission, fence and rally transfer frame handlers
 * (MISSION_ACK, MISSION_REQUEST(_INT), MISSION_COUNT, MISSION_ITEM_INT).
 *
 * @module protocol/mission-frame-handlers
 */

import type { MissionItem } from './types'
import type { MAVLinkFrame } from './mavlink-parser'
import { firstMissingSeq, type MissionContext, type UploadProgress } from './mavlink-adapter-missions'
import { decodeFenceMissionItems } from './fence-mission-codec'
import {
  decodeMissionAck, decodeMissionRequestInt,
  decodeMissionCount, decodeMissionItemInt as decodeMissionItemIntMsg,
} from './messages'
import { encodeMissionItemInt, encodeMissionRequestInt, encodeMissionAck } from './encoders'

/** MAV_MISSION_ACCEPTED. */
const MAV_MISSION_ACCEPTED = 0
/** MAV_MISSION_INVALID_SEQUENCE. */
const MAV_MISSION_INVALID_SEQUENCE = 13

/**
 * A MISSION_ACK error from the vehicle while a download of the same mission
 * type is active ends that download with the vehicle's reason, instead of
 * re-requesting until the idle deadline. Returns true when it settled one.
 */
function refuseDownload(s: MissionContext, missionType: number, result: number): boolean {
  const err = new Error(`Vehicle refused download: MAV_MISSION_RESULT ${result}`)
  if (missionType === 0 && s.missionDownload) {
    const dl = s.missionDownload; s.missionDownload = null; dl.stop(); dl.reject(err); return true
  }
  if (missionType === 1 && s.fenceDownload) {
    const dl = s.fenceDownload; s.fenceDownload = null; dl.stop(); dl.reject(err); return true
  }
  if (missionType === 2 && s.rallyDownload) {
    const dl = s.rallyDownload; s.rallyDownload = null; dl.stop(); dl.reject(err); return true
  }
  return false
}

/**
 * Whether a MISSION_ACK ends an active upload.
 *
 * - ArduPilot answers an item whose seq it was not expecting (a duplicate sent
 *   after its own re-request on a slow link) with INVALID_SEQUENCE and keeps
 *   receiving, re-requesting the item it wants; that ACK is not the end of
 *   the transfer.
 * - ACCEPTED only completes an upload once the vehicle has asked for the last
 *   item (or the upload has no items). An earlier ACCEPTED is a stale reply to
 *   a previous transaction; the vehicle still drives this one.
 */
function ackEndsUpload(s: MissionContext, upload: UploadProgress, type: number): boolean {
  if (type === MAV_MISSION_INVALID_SEQUENCE && s.firmwareHandler?.firmwareType.startsWith('ardupilot-')) return false
  if (type !== MAV_MISSION_ACCEPTED) return true
  return upload.items.length === 0 || upload.highestRequested === upload.items.length - 1
}

export function handleMissionAckFrame(s: MissionContext, frame: MAVLinkFrame): void {
  const ack = decodeMissionAck(frame.payload)
  if (ack.type !== 0 && refuseDownload(s, ack.missionType, ack.type)) return
  if (ack.missionType === 2 && s.rallyUpload) {
    if (!ackEndsUpload(s, s.rallyUpload, ack.type)) return
    s.rallyUpload.stop()
    s.rallyUpload.resolve({
      success: ack.type === 0, resultCode: ack.type,
      message: ack.type === 0 ? 'Rally points accepted' : `Rally points rejected: type ${ack.type}`,
    })
    s.rallyUpload = null
    return
  }
  if (ack.missionType === 1 && s.fenceUpload) {
    if (!ackEndsUpload(s, s.fenceUpload, ack.type)) return
    s.fenceUpload.stop()
    s.fenceUpload.resolve({
      success: ack.type === 0, resultCode: ack.type,
      message: ack.type === 0 ? 'Fence accepted' : `Fence rejected: type ${ack.type}`,
    })
    s.fenceUpload = null
    return
  }
  if (ack.missionType === 0 && s.missionUpload) {
    if (!ackEndsUpload(s, s.missionUpload, ack.type)) return
    s.missionUpload.stop()
    s.missionUpload.resolve({
      success: ack.type === 0, resultCode: ack.type,
      message: ack.type === 0 ? 'Mission accepted' : `Mission rejected: type ${ack.type}`,
      ...(ack.type === 0 && ack.opaqueId !== 0 ? { opaqueId: ack.opaqueId } : {}),
    })
    s.missionUpload = null
  }
}

export function handleMissionRequestFrame(s: MissionContext, frame: MAVLinkFrame): void {
  const req = decodeMissionRequestInt(frame.payload)
  if (req.missionType === 2 && s.rallyUpload && req.seq < s.rallyUpload.items.length) {
    s.rallyUpload.restartTimer()
    s.rallyUpload.highestRequested = Math.max(s.rallyUpload.highestRequested, req.seq)
    const pt = s.rallyUpload.items[req.seq]
    s.transport?.send(encodeMissionItemInt(
      s.targetSysId, s.targetCompId, req.seq, pt.frame, 5100, 0, 0,
      0, 0, 0, 0, Math.round(pt.lat * 1e7), Math.round(pt.lon * 1e7), pt.alt,
      s.sysId, s.compId, 2,
    ))
    return
  }
  if (req.missionType === 1 && s.fenceUpload && req.seq < s.fenceUpload.items.length) {
    s.fenceUpload.restartTimer()
    s.fenceUpload.highestRequested = Math.max(s.fenceUpload.highestRequested, req.seq)
    const fi = s.fenceUpload.items[req.seq]
    s.transport?.send(encodeMissionItemInt(
      s.targetSysId, s.targetCompId, fi.seq, fi.frame, fi.command, 0, 1,
      fi.param1, fi.param2, 0, 0, fi.x, fi.y, fi.z,
      s.sysId, s.compId, 1,
    ))
    return
  }
  if (req.missionType === 0 && s.missionUpload && req.seq < s.missionUpload.items.length) {
    // The FC asking for the next item is progress: re-arm the inactivity
    // budget so a long mission over a slow radio is not abandoned mid-walk.
    s.missionUpload.restartTimer()
    s.missionUpload.highestRequested = Math.max(s.missionUpload.highestRequested, req.seq)
    const item = s.missionUpload.items[req.seq]
    s.transport?.send(encodeMissionItemInt(
      s.targetSysId, s.targetCompId,
      item.seq, item.frame, item.command, item.current, item.autocontinue,
      item.param1, item.param2, item.param3, item.param4,
      item.x, item.y, item.z, s.sysId, s.compId,
    ))
  }
}

/**
 * MISSION_COUNT answering a download's list request. A COUNT arriving once the
 * count is known (a late reply to a re-sent request list on a slow link) is
 * ignored: restarting the walk would re-request seq 0, which PX4 answers with
 * an error. An empty list completes the download, and the GCS acknowledges it
 * like any other completed download so the vehicle leaves its send state.
 */
export function handleMissionCountResponse(s: MissionContext, frame: MAVLinkFrame): void {
  const data = decodeMissionCount(frame.payload)
  const ackEmpty = (missionType: number) =>
    s.transport?.send(encodeMissionAck(s.targetSysId, s.targetCompId, MAV_MISSION_ACCEPTED, s.sysId, s.compId, missionType))
  if (data.missionType === 2 && s.rallyDownload) {
    if (s.rallyDownload.total > 0) return
    s.rallyDownload.total = data.count
    s.rallyDownload.restartTimer()
    if (data.count === 0) { s.rallyDownload.stop(); ackEmpty(2); s.rallyDownload.resolve([]); s.rallyDownload = null; return }
    s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId, 2))
    return
  }
  if (data.missionType === 1 && s.fenceDownload) {
    if (s.fenceDownload.total > 0) return
    s.fenceDownload.total = data.count
    s.fenceDownload.restartTimer()
    if (data.count === 0) { s.fenceDownload.stop(); ackEmpty(1); s.fenceDownload.resolve([]); s.fenceDownload = null; return }
    s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId, 1))
    return
  }
  if (data.missionType !== 0 || !s.missionDownload) return
  if (s.missionDownload.total > 0) return
  s.missionDownload.total = data.count
  s.missionDownload.restartTimer()
  if (data.count === 0) { s.missionDownload.stop(); ackEmpty(0); s.missionDownload.resolve([]); s.missionDownload = null; return }
  s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId))
}

export function handleMissionItemIntResponse(s: MissionContext, frame: MAVLinkFrame): void {
  const data = decodeMissionItemIntMsg(frame.payload)

  // An item outside the announced count is not part of this transfer (a
  // stale frame, or another GCS's exchange); storing it would pad the result.
  if (data.missionType === 2 && s.rallyDownload) {
    if (data.seq >= s.rallyDownload.total) return
    s.rallyDownload.items.set(data.seq, { lat: data.x / 1e7, lon: data.y / 1e7, alt: data.z, frame: data.frame })
    s.rallyDownload.restartTimer()
    const next = firstMissingSeq(s.rallyDownload.items, s.rallyDownload.total)
    if (next === null) {
      s.rallyDownload.stop()
      const items = Array.from(s.rallyDownload.items.entries()).sort((a, b) => a[0] - b[0]).map(([, pt]) => pt)
      s.transport?.send(encodeMissionAck(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId, 2))
      s.rallyDownload.resolve(items); s.rallyDownload = null
    } else {
      s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, next, s.sysId, s.compId, 2))
    }
    return
  }
  if (data.missionType === 1 && s.fenceDownload) {
    if (data.seq >= s.fenceDownload.total) return
    s.fenceDownload.items.set(data.seq, {
      seq: data.seq, frame: data.frame, command: data.command,
      param1: data.param1, param2: data.param2, x: data.x, y: data.y, z: data.z,
    })
    s.fenceDownload.restartTimer()
    const next = firstMissingSeq(s.fenceDownload.items, s.fenceDownload.total)
    if (next === null) {
      s.fenceDownload.stop()
      const elements = decodeFenceMissionItems(Array.from(s.fenceDownload.items.values()))
      s.transport?.send(encodeMissionAck(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId, 1))
      s.fenceDownload.resolve(elements); s.fenceDownload = null
    } else {
      s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, next, s.sysId, s.compId, 1))
    }
    return
  }
  if (data.missionType !== 0 || !s.missionDownload || data.seq >= s.missionDownload.total) return
  const item: MissionItem = {
    seq: data.seq, frame: data.frame, command: data.command,
    current: data.current, autocontinue: data.autocontinue,
    param1: data.param1, param2: data.param2, param3: data.param3, param4: data.param4,
    x: data.x, y: data.y, z: data.z,
  }
  s.missionDownload.items.set(data.seq, item)
  s.missionDownload.restartTimer()
  const next = firstMissingSeq(s.missionDownload.items, s.missionDownload.total)
  if (next === null) {
    s.missionDownload.stop()
    const items = Array.from(s.missionDownload.items.values()).sort((a, b) => a.seq - b.seq)
    s.transport?.send(encodeMissionAck(s.targetSysId, s.targetCompId, 0, s.sysId, s.compId))
    s.missionDownload.resolve(items); s.missionDownload = null
  } else {
    s.transport?.send(encodeMissionRequestInt(s.targetSysId, s.targetCompId, next, s.sysId, s.compId))
  }
}
