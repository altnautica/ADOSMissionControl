/**
 * MAVLink adapter — mission, rally, and fence protocol methods.
 *
 * Upload/download missions, rally points, fence points, and clear.
 *
 * @module protocol/mavlink-adapter-missions
 */

import type { Transport, CommandResult, MissionItem, FirmwareHandler, FenceElement, RallyPointItem, MissionUploadProgressCallback } from './types'
import {
  encodeMissionCount, encodeMissionRequestList, encodeMissionClearAll,
  encodeMissionRequestInt,
  MAV_MISSION_TYPE_FENCE,
} from './encoders'
import { encodeFenceMissionItems, type FenceMissionItem } from './fence-mission-codec'
import { createDeadline, createUploadDeadline, sendOpening, type TransferDeadline } from './mission-transfer-deadline'
import { MISSION_TRANSFER_NOT_CONNECTED, MISSION_TRANSFER_STALLED } from './mission-result'

/**
 * What every upload tracks: the items it sends and the highest seq the
 * vehicle has asked for, so ACCEPTED is only taken once the last item went out.
 */
export interface UploadProgress {
  items: readonly unknown[]
  /** Highest seq the vehicle has requested; -1 before the first request. */
  highestRequested: number
}

export interface MissionUploadState extends TransferDeadline, UploadProgress {
  items: MissionItem[]
  resolve: (result: CommandResult) => void
  reject: (err: Error) => void
  /** Told the number of items sent so far each time the vehicle asks for one. */
  onProgress?: MissionUploadProgressCallback
}

/**
 * The lowest sequence number in `[0, total)` that has not arrived, or `null`
 * when the walk is complete. Re-requesting the lowest gap (not `received + 1`)
 * keeps the walk self-healing when a request or an item is lost.
 */
export function firstMissingSeq(items: ReadonlyMap<number, unknown>, total: number): number | null {
  for (let seq = 0; seq < total; seq++) {
    if (!items.has(seq)) return seq
  }
  return null
}

/**
 * What a stalled download re-sends: the list request while the count has not
 * arrived, otherwise a request for the lowest missing item.
 */
function resendDownloadRequest(
  ctx: MissionContext,
  state: { items: ReadonlyMap<number, unknown>; total: number },
  missionType: number,
): void {
  if (state.total === 0) {
    ctx.transport?.send(encodeMissionRequestList(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId, missionType))
    return
  }
  const next = firstMissingSeq(state.items, state.total)
  if (next !== null) {
    ctx.transport?.send(encodeMissionRequestInt(ctx.targetSysId, ctx.targetCompId, next, ctx.sysId, ctx.compId, missionType))
  }
}

export interface MissionDownloadState extends TransferDeadline {
  items: Map<number, MissionItem>
  total: number
  resolve: (items: MissionItem[]) => void
  reject: (err: Error) => void
}

export interface RallyUploadState extends TransferDeadline, UploadProgress {
  items: RallyPointItem[]
  resolve: (result: CommandResult) => void
}

export interface RallyDownloadState extends TransferDeadline {
  items: Map<number, RallyPointItem>
  total: number
  resolve: (items: RallyPointItem[]) => void
  reject: (err: Error) => void
}

export interface FenceUploadState extends TransferDeadline, UploadProgress {
  items: FenceMissionItem[]
  resolve: (result: CommandResult) => void
}

export interface FenceDownloadState extends TransferDeadline {
  items: Map<number, FenceMissionItem>
  total: number
  resolve: (elements: FenceElement[]) => void
  reject: (err: Error) => void
}

export interface MissionContext {
  transport: Transport | null
  firmwareHandler: FirmwareHandler | null
  targetSysId: number
  targetCompId: number
  sysId: number
  compId: number
  missionUpload: MissionUploadState | null
  missionDownload: MissionDownloadState | null
  rallyUpload: RallyUploadState | null
  rallyDownload: RallyDownloadState | null
  fenceUpload: FenceUploadState | null
  fenceDownload: FenceDownloadState | null
  /**
   * Tail of each mission type's transfer chain, keyed by MAV_MISSION_TYPE.
   * The vehicle runs one transaction per mission type, so every transfer of a
   * type waits for the previous one of that type to settle before it starts.
   */
  transferChains: Map<number, Promise<void>>
  sendCommandLong: (command: number, params: [number, number, number, number, number, number, number], timeoutMs?: number) => Promise<CommandResult>
}

/**
 * Run `transfer` after every earlier transfer of the same mission type has
 * settled. Two uploads (or a clear and an upload) of one type would otherwise
 * interleave MISSION_COUNTs and restart each other's transaction on the FC.
 * With nothing of that type in flight the transfer starts at once, so its
 * first frame goes out in the caller's turn.
 */
function serialized<T>(ctx: MissionContext, missionType: number, transfer: () => Promise<T>): Promise<T> {
  const prev = ctx.transferChains.get(missionType)
  const run = prev ? prev.then(transfer) : transfer()
  const tail = run.then(() => undefined, () => undefined)
  ctx.transferChains.set(missionType, tail)
  void tail.then(() => {
    if (ctx.transferChains.get(missionType) === tail) ctx.transferChains.delete(missionType)
  })
  return run
}

/** Settle every in-flight mission, fence and rally transfer with `reason` and stop its timers. */
export function cancelMissionTransfers(ctx: MissionContext, reason: string): void {
  const failed = { success: false, resultCode: -1, message: reason }
  const err = new Error(reason)
  const { missionUpload, missionDownload, rallyUpload, rallyDownload, fenceUpload, fenceDownload } = ctx
  ctx.missionUpload = null; ctx.missionDownload = null
  ctx.rallyUpload = null; ctx.rallyDownload = null
  ctx.fenceUpload = null; ctx.fenceDownload = null
  if (missionUpload) { missionUpload.stop(); missionUpload.resolve(failed) }
  if (rallyUpload) { rallyUpload.stop(); rallyUpload.resolve(failed) }
  if (fenceUpload) { fenceUpload.stop(); fenceUpload.resolve(failed) }
  if (missionDownload) { missionDownload.stop(); missionDownload.reject(err) }
  if (rallyDownload) { rallyDownload.stop(); rallyDownload.reject(err) }
  if (fenceDownload) { fenceDownload.stop(); fenceDownload.reject(err) }
}

export function uploadMission(ctx: MissionContext, items: MissionItem[], onProgress?: MissionUploadProgressCallback): Promise<CommandResult> {
  return serialized(ctx, 0, () => startMissionUpload(ctx, items, onProgress))
}

async function startMissionUpload(ctx: MissionContext, items: MissionItem[], onProgress?: MissionUploadProgressCallback): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) return { success: false, resultCode: MISSION_TRANSFER_NOT_CONNECTED, message: 'Not connected' }

  const { promise, resolve, reject } = Promise.withResolvers<CommandResult>()

  // Inactivity budget, re-armed on every MISSION_REQUEST the FC sends. A flat
  // 15 s wall clock abandoned a transfer the flight controller was still
  // driving — a long mission over a slow radio simply cannot finish inside it,
  // and the GCS then reported a timeout for an upload still in progress.
  const onIdle = () => {
    if (ctx.missionUpload !== state) return
    ctx.missionUpload = null
    resolve({ success: false, resultCode: MISSION_TRANSFER_STALLED, message: 'Mission upload stalled: flight controller stopped requesting items' })
  }
  const sendCount = () => ctx.transport?.send(encodeMissionCount(ctx.targetSysId, ctx.targetCompId, items.length, ctx.sysId, ctx.compId))
  const onSendError = (err: Error) => {
    if (ctx.missionUpload !== state) return
    ctx.missionUpload = null
    resolve({ success: false, resultCode: -1, message: err.message })
  }
  const state: MissionUploadState = Object.assign(
    createUploadDeadline(onIdle, sendCount, () => ctx.missionUpload === state, onSendError),
    { items, resolve, reject, highestRequested: -1, onProgress },
  )
  ctx.missionUpload = state
  sendOpening(state, sendCount, onSendError)
  return promise
}

export function downloadMission(ctx: MissionContext): Promise<MissionItem[]> {
  return serialized(ctx, 0, () => startMissionDownload(ctx))
}

async function startMissionDownload(ctx: MissionContext): Promise<MissionItem[]> {
  if (!ctx.transport?.isConnected) throw new Error('Not connected')

  const { promise, resolve, reject } = Promise.withResolvers<MissionItem[]>()

  const onIdle = () => {
    const state = ctx.missionDownload
    if (!state) return
    ctx.missionDownload = null
    // A short list is a FAILED download, never a mission. Resolving it as
    // success let the planner replace the plan with a truncated one and let
    // the operator save it to disk or upload it back.
    reject(new Error(
      `Mission download incomplete: received ${state.items.size} of ${state.total} items`,
    ))
  }

  const onSendError = (err: Error) => {
    if (ctx.missionDownload !== state) return
    ctx.missionDownload = null
    reject(err)
  }
  const state: MissionDownloadState = Object.assign(
    createDeadline(onIdle, () => resendDownloadRequest(ctx, state, 0), () => ctx.missionDownload === state, onSendError),
    { items: new Map<number, MissionItem>(), total: 0, resolve, reject },
  )
  ctx.missionDownload = state
  const transport = ctx.transport
  sendOpening(state, () => transport.send(encodeMissionRequestList(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId)), onSendError)
  return promise
}

export async function setCurrentMissionItem(ctx: MissionContext, seq: number): Promise<CommandResult> {
  return ctx.sendCommandLong(224, [seq, 0, 0, 0, 0, 0, 0])
}

export function clearMission(ctx: MissionContext): Promise<CommandResult> {
  return serialized(ctx, 0, () => startMissionClear(ctx))
}

/** Overall budget for a mission clear to be acknowledged. */
const CLEAR_TIMEOUT_MS = 5000

async function startMissionClear(ctx: MissionContext): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) return { success: false, resultCode: -1, message: 'Not connected' }

  const { promise, resolve } = Promise.withResolvers<CommandResult>()

  // A clear is a MISSION_CLEAR_ALL awaiting one MISSION_ACK. The frame is
  // re-sent on the shared retry loop until the ACK arrives (a lost clear on a
  // lossy link is retried, as the mission protocol requires), within a 5 s
  // overall budget; there are no items, so nothing re-arms that budget.
  const transport = ctx.transport
  const sendClear = () => transport.send(encodeMissionClearAll(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId))
  const onSendError = (err: Error) => {
    if (ctx.missionUpload !== state) return
    ctx.missionUpload = null
    resolve({ success: false, resultCode: -1, message: err.message })
  }
  const onTimeout = () => {
    if (ctx.missionUpload !== state) return
    ctx.missionUpload = null
    resolve({ success: false, resultCode: -1, message: 'Mission clear timed out' })
  }
  const deadline = createDeadline(onTimeout, sendClear, () => ctx.missionUpload === state, onSendError)
  clearTimeout(deadline.timer)
  deadline.timer = setTimeout(() => { deadline.stop(); onTimeout() }, CLEAR_TIMEOUT_MS)
  const state: MissionUploadState = Object.assign(deadline, {
    items: [],
    highestRequested: -1,
    resolve,
    reject: () => resolve({ success: false, resultCode: -1, message: 'Mission clear failed' }),
  })
  ctx.missionUpload = state
  sendOpening(state, sendClear, onSendError)
  return promise
}

/**
 * Upload the geofence as a fence-type mission (mission_type = fence), the
 * fence protocol ArduPilot (4.0 and later) and PX4 both speak. Kept separate
 * from the waypoint-mission and rally state machines so uploading a fence
 * never touches the waypoint mission. An empty element list uploads a count
 * of 0, which clears the fence on the vehicle.
 */
export function uploadFenceMission(ctx: MissionContext, elements: FenceElement[]): Promise<CommandResult> {
  return serialized(ctx, MAV_MISSION_TYPE_FENCE, () => startFenceUpload(ctx, elements))
}

async function startFenceUpload(ctx: MissionContext, elements: FenceElement[]): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) return { success: false, resultCode: -1, message: 'Not connected' }
  const items = encodeFenceMissionItems(elements)

  const { promise, resolve } = Promise.withResolvers<CommandResult>()
  const onIdle = () => {
    if (ctx.fenceUpload !== state) return
    ctx.fenceUpload = null
    resolve({ success: false, resultCode: -1, message: 'Fence upload stalled: flight controller stopped requesting items' })
  }
  const sendCount = () => ctx.transport?.send(encodeMissionCount(
    ctx.targetSysId, ctx.targetCompId, items.length,
    ctx.sysId, ctx.compId, MAV_MISSION_TYPE_FENCE,
  ))
  const onSendError = (err: Error) => {
    if (ctx.fenceUpload !== state) return
    ctx.fenceUpload = null
    resolve({ success: false, resultCode: -1, message: err.message })
  }
  const state: FenceUploadState = Object.assign(
    createUploadDeadline(onIdle, sendCount, () => ctx.fenceUpload === state, onSendError),
    { items, resolve, highestRequested: -1 },
  )
  ctx.fenceUpload = state
  sendOpening(state, sendCount, onSendError)
  return promise
}

/**
 * Download the geofence as a fence-type mission (mission_type = fence) and
 * reassemble it into the fence model.
 */
export function downloadFenceMission(ctx: MissionContext): Promise<FenceElement[]> {
  return serialized(ctx, MAV_MISSION_TYPE_FENCE, () => startFenceDownload(ctx))
}

async function startFenceDownload(ctx: MissionContext): Promise<FenceElement[]> {
  if (!ctx.transport?.isConnected) throw new Error('Not connected')

  const { promise, resolve, reject } = Promise.withResolvers<FenceElement[]>()

  const onIdle = () => {
    const state = ctx.fenceDownload
    if (!state) {
      reject(new Error('Fence download stalled before the flight controller answered'))
      return
    }
    ctx.fenceDownload = null
    reject(new Error(
      `Fence download incomplete: received ${state.items.size} of ${state.total} items`,
    ))
  }

  const onSendError = (err: Error) => {
    if (ctx.fenceDownload !== state) return
    ctx.fenceDownload = null
    reject(err)
  }
  const state: FenceDownloadState = Object.assign(
    createDeadline(onIdle, () => resendDownloadRequest(ctx, state, MAV_MISSION_TYPE_FENCE), () => ctx.fenceDownload === state, onSendError),
    { items: new Map<number, FenceMissionItem>(), total: 0, resolve, reject },
  )
  ctx.fenceDownload = state
  const transport = ctx.transport
  sendOpening(state, () => transport.send(encodeMissionRequestList(
    ctx.targetSysId, ctx.targetCompId,
    ctx.sysId, ctx.compId, MAV_MISSION_TYPE_FENCE,
  )), onSendError)
  return promise
}

/**
 * Upload rally points, each in its own altitude frame; an empty list uploads a
 * count of 0, which clears them on the vehicle.
 */
export function uploadRallyPoints(ctx: MissionContext, points: RallyPointItem[]): Promise<CommandResult> {
  return serialized(ctx, 2, () => startRallyUpload(ctx, points))
}

async function startRallyUpload(ctx: MissionContext, points: RallyPointItem[]): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) return { success: false, resultCode: -1, message: 'Not connected' }

  const { promise, resolve } = Promise.withResolvers<CommandResult>()
  const onIdle = () => {
    if (ctx.rallyUpload !== state) return
    ctx.rallyUpload = null
    resolve({ success: false, resultCode: -1, message: 'Rally point upload stalled: flight controller stopped requesting items' })
  }
  const sendCount = () => ctx.transport?.send(encodeMissionCount(
    ctx.targetSysId, ctx.targetCompId, points.length,
    ctx.sysId, ctx.compId, 2,
  ))
  const onSendError = (err: Error) => {
    if (ctx.rallyUpload !== state) return
    ctx.rallyUpload = null
    resolve({ success: false, resultCode: -1, message: err.message })
  }
  const state: RallyUploadState = Object.assign(
    createUploadDeadline(onIdle, sendCount, () => ctx.rallyUpload === state, onSendError),
    { items: points, resolve, highestRequested: -1 },
  )
  ctx.rallyUpload = state
  sendOpening(state, sendCount, onSendError)
  return promise
}

/** Download rally points, each with the MAV_FRAME the vehicle stored its altitude in. */
export function downloadRallyPoints(ctx: MissionContext): Promise<RallyPointItem[]> {
  return serialized(ctx, 2, () => startRallyDownload(ctx))
}

async function startRallyDownload(ctx: MissionContext): Promise<RallyPointItem[]> {
  if (!ctx.transport?.isConnected) throw new Error('Not connected')

  const { promise, resolve, reject } = Promise.withResolvers<RallyPointItem[]>()

  const onIdle = () => {
    const state = ctx.rallyDownload
    if (!state) {
      reject(new Error('Rally download stalled before the flight controller answered'))
      return
    }
    ctx.rallyDownload = null
    reject(new Error(
      `Rally download incomplete: received ${state.items.size} of ${state.total} points`,
    ))
  }

  const onSendError = (err: Error) => {
    if (ctx.rallyDownload !== state) return
    ctx.rallyDownload = null
    reject(err)
  }
  const state: RallyDownloadState = Object.assign(
    createDeadline(onIdle, () => resendDownloadRequest(ctx, state, 2), () => ctx.rallyDownload === state, onSendError),
    { items: new Map<number, RallyPointItem>(), total: 0, resolve, reject },
  )
  ctx.rallyDownload = state
  const transport = ctx.transport
  sendOpening(state, () => transport.send(encodeMissionRequestList(
    ctx.targetSysId, ctx.targetCompId,
    ctx.sysId, ctx.compId, 2,
  )), onSendError)
  return promise
}
