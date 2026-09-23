/**
 * MAVLink adapter — mission, rally, and fence protocol methods.
 *
 * Upload/download missions, rally points, fence points, and clear.
 *
 * @module protocol/mavlink-adapter-missions
 */

import type { Transport, CommandResult, MissionItem, FirmwareHandler, FencePointCallback, ParameterCallback, FenceElement } from './types'
import {
  encodeMissionCount, encodeMissionRequestList, encodeMissionClearAll,
  encodeFencePoint, encodeFenceFetchPoint,
  encodeMissionRequestInt,
  MAV_MISSION_TYPE_FENCE,
} from './mavlink-encoder'

/** MAV_FRAME_GLOBAL. Altitude is Reserved for fence polygon/circle vertices. */
const MAV_FRAME_GLOBAL = 0

/** NAV_FENCE_* mission-item commands (used when mission_type = fence). */
export const MAV_CMD_NAV_FENCE_RETURN_POINT = 5000
export const MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION = 5001
export const MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION = 5002
export const MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION = 5003
export const MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION = 5004

/** A single fence mission item, flattened and ready for MISSION_ITEM_INT. */
export interface FenceMissionItem {
  seq: number
  frame: number
  command: number
  param1: number
  param2: number
  /** Latitude * 1e7. */
  x: number
  /** Longitude * 1e7. */
  y: number
  z: number
}

export interface MissionUploadState extends TransferDeadline {
  items: MissionItem[]
  resolve: (result: CommandResult) => void
  reject: (err: Error) => void
}

/**
 * Shared shape of a `MISSION_REQUEST_INT` walk.
 *
 * `restartTimer` re-arms the inactivity deadline on EVERY received item, and
 * `reject` fires when that deadline expires with a short list. The three
 * downloads previously shared one 15 s wall-clock budget that RESOLVED
 * successfully with whatever had arrived: a single dropped
 * `MISSION_REQUEST_INT` stalled the walk, the timer handed back a truncated
 * list, `mission-store` set `downloadState: "downloaded"` and replaced the
 * plan, and the operator could save that short plan to disk or upload it back.
 * 15 s was also a hard cap on usable mission size over a 57k6 link.
 */
interface TransferDeadline {
  /** Re-arm the inactivity deadline. Called on each received item. */
  restartTimer: () => void;
  timer: ReturnType<typeof setTimeout>
}

export interface MissionDownloadState extends TransferDeadline {
  items: Map<number, MissionItem>
  total: number
  resolve: (items: MissionItem[]) => void
  reject: (err: Error) => void
}

export interface RallyUploadState {
  items: Array<{ lat: number; lon: number; alt: number }>
  resolve: (result: CommandResult) => void
  timer: ReturnType<typeof setTimeout>
}

export interface RallyDownloadState extends TransferDeadline {
  items: Map<number, { lat: number; lon: number; alt: number }>
  total: number
  resolve: (items: Array<{ lat: number; lon: number; alt: number }>) => void
  reject: (err: Error) => void
}

export interface FenceUploadState {
  items: FenceMissionItem[]
  resolve: (result: CommandResult) => void
  timer: ReturnType<typeof setTimeout>
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
  sendCommandLong: (command: number, params: [number, number, number, number, number, number, number], timeoutMs?: number) => Promise<CommandResult>
  onParameter: (cb: ParameterCallback) => () => void
  onFencePoint: (cb: FencePointCallback) => () => void
  getParameter: (name: string) => Promise<{ value: number }>
  setParameter: (name: string, value: number) => Promise<CommandResult>
}

/**
 * Flatten the fence model into a seq-indexed list of MISSION_ITEM_INT items for
 * a fence-type mission upload. A polygon emits one item per vertex, each
 * carrying param1 = the polygon's total vertex count (min 3); a circle emits one
 * item with param1 = radius (m). Elements with fewer than 3 polygon vertices are
 * skipped. Lat/lon are scaled to int32 * 1e7; altitude is Reserved (z = 0).
 */
export function encodeFenceMissionItems(elements: FenceElement[]): FenceMissionItem[] {
  const items: FenceMissionItem[] = []
  let seq = 0
  for (const el of elements) {
    if (el.kind === 'polygon') {
      const n = el.vertices.length
      if (n < 3) continue
      const command = el.role === 'inclusion'
        ? MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION
        : MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION
      const group = el.role === 'inclusion' ? (el.group ?? 0) : 0
      for (const v of el.vertices) {
        items.push({
          seq: seq++, frame: MAV_FRAME_GLOBAL, command,
          param1: n, param2: group,
          x: Math.round(v.lat * 1e7), y: Math.round(v.lon * 1e7), z: 0,
        })
      }
    } else {
      const command = el.role === 'inclusion'
        ? MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION
        : MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION
      const group = el.role === 'inclusion' ? (el.group ?? 0) : 0
      items.push({
        seq: seq++, frame: MAV_FRAME_GLOBAL, command,
        param1: el.radius, param2: group,
        x: Math.round(el.center.lat * 1e7), y: Math.round(el.center.lon * 1e7), z: 0,
      })
    }
  }
  return items
}

/**
 * Reassemble downloaded fence mission items into the fence model. Consecutive
 * polygon-vertex items of the same command are grouped into one polygon using
 * param1 (vertex count); each circle item is a standalone element; a return
 * point (5000) is ignored. Items are sorted by seq first.
 */
export function decodeFenceMissionItems(items: FenceMissionItem[]): FenceElement[] {
  const sorted = [...items].sort((a, b) => a.seq - b.seq)
  const elements: FenceElement[] = []
  let poly: { role: 'inclusion' | 'exclusion'; command: number; group: number; remaining: number; vertices: Array<{ lat: number; lon: number }> } | null = null

  const flushPoly = () => {
    if (poly && poly.vertices.length >= 3) {
      elements.push({ kind: 'polygon', role: poly.role, vertices: poly.vertices, group: poly.group })
    }
    poly = null
  }

  for (const it of sorted) {
    if (
      it.command === MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION ||
      it.command === MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION
    ) {
      const role = it.command === MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION ? 'inclusion' : 'exclusion'
      const count = Math.max(3, Math.round(it.param1))
      if (!poly || poly.command !== it.command || poly.remaining <= 0) {
        flushPoly()
        poly = { role, command: it.command, group: Math.round(it.param2), remaining: count, vertices: [] }
      }
      poly.vertices.push({ lat: it.x / 1e7, lon: it.y / 1e7 })
      poly.remaining -= 1
      if (poly.remaining <= 0) flushPoly()
    } else if (
      it.command === MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION ||
      it.command === MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION
    ) {
      flushPoly()
      const role = it.command === MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION ? 'inclusion' : 'exclusion'
      elements.push({
        kind: 'circle', role,
        center: { lat: it.x / 1e7, lon: it.y / 1e7 },
        radius: it.param1, group: Math.round(it.param2),
      })
    }
    // MAV_CMD_NAV_FENCE_RETURN_POINT (5000) carries no geometry we model, ignore.
  }
  flushPoly()
  return elements
}

export async function uploadMission(ctx: MissionContext, items: MissionItem[]): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) return { success: false, resultCode: -1, message: 'Not connected' }

  const { promise, resolve, reject } = Promise.withResolvers<CommandResult>()

  // Inactivity budget, re-armed on every MISSION_REQUEST the FC sends. A flat
  // 15 s wall clock abandoned a transfer the flight controller was still
  // driving — a long mission over a slow radio simply cannot finish inside it,
  // and the GCS then reported a timeout for an upload still in progress.
  const onIdle = () => {
    ctx.missionUpload = null
    resolve({ success: false, resultCode: -1, message: 'Mission upload stalled: flight controller stopped requesting items' })
  }
  const state: MissionUploadState = {
    items,
    resolve,
    reject,
    timer: setTimeout(onIdle, TRANSFER_IDLE_TIMEOUT_MS),
    restartTimer: () => {
      clearTimeout(state.timer)
      state.timer = setTimeout(onIdle, TRANSFER_IDLE_TIMEOUT_MS)
    },
  }
  ctx.missionUpload = state
  ctx.transport.send(encodeMissionCount(ctx.targetSysId, ctx.targetCompId, items.length, ctx.sysId, ctx.compId))
  return promise
}

/**
 * Inactivity window for a mission/rally/fence item walk.
 *
 * Re-armed on EVERY received item, so the budget bounds a silent link rather
 * than the total transfer — a 300-item mission over a 57k6 radio is a long
 * transfer, not a failed one.
 */
const TRANSFER_IDLE_TIMEOUT_MS = 15000

export async function downloadMission(ctx: MissionContext): Promise<MissionItem[]> {
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

  const state: MissionDownloadState = {
    items: new Map(),
    total: 0,
    resolve,
    reject,
    timer: setTimeout(onIdle, TRANSFER_IDLE_TIMEOUT_MS),
    restartTimer: () => {
      clearTimeout(state.timer)
      state.timer = setTimeout(onIdle, TRANSFER_IDLE_TIMEOUT_MS)
    },
  }
  ctx.missionDownload = state
  ctx.transport.send(encodeMissionRequestList(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId))
  return promise
}

export async function setCurrentMissionItem(ctx: MissionContext, seq: number): Promise<CommandResult> {
  return ctx.sendCommandLong(224, [seq, 0, 0, 0, 0, 0, 0])
}

export async function clearMission(ctx: MissionContext): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) return { success: false, resultCode: -1, message: 'Not connected' }

  const { promise, resolve } = Promise.withResolvers<CommandResult>()

  // A clear is a single MISSION_CLEAR_ALL awaiting one MISSION_ACK; there are
  // no items, so there is nothing to re-arm the deadline on.
  const state: MissionUploadState = {
    items: [],
    resolve,
    reject: () => resolve({ success: false, resultCode: -1, message: 'Mission clear failed' }),
    timer: setTimeout(() => {
      ctx.missionUpload = null
      resolve({ success: false, resultCode: -1, message: 'Mission clear timed out' })
    }, 5000),
    restartTimer: () => {},
  }
  ctx.missionUpload = state
  ctx.transport.send(encodeMissionClearAll(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId))
  return promise
}

/**
 * Upload the geofence over the legacy FENCE_POINT protocol.
 *
 * The legacy protocol has no per-point acknowledgement: the FC sizes its fence
 * table from `FENCE_TOTAL` and then accepts that many FENCE_POINT writes. So
 * this does three things, and reports failure at each — it previously sent the
 * points blind, never wrote FENCE_TOTAL at all (leaving the FC's table at its
 * previous size, silently truncating or ignoring the upload), and returned an
 * unconditional `success: true`:
 *
 *  1. write `FENCE_TOTAL` and require the FC's PARAM_VALUE echo to match,
 *  2. emit the FENCE_POINTs,
 *  3. fetch every index back and compare coordinates.
 */
export async function uploadFence(ctx: MissionContext, points: Array<{ lat: number; lon: number }>): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }

  const totalWrite = await ctx.setParameter('FENCE_TOTAL', points.length)
  if (!totalWrite.success) {
    return {
      success: false,
      resultCode: -1,
      message: `Flight controller did not accept FENCE_TOTAL=${points.length}: ${totalWrite.message}`,
    }
  }
  if (points.length === 0) {
    return { success: true, resultCode: 0, message: 'Fence cleared' }
  }

  for (let i = 0; i < points.length; i++) {
    ctx.transport.send(encodeFencePoint(
      ctx.targetSysId, ctx.targetCompId,
      i, points.length, points[i].lat, points[i].lon,
      ctx.sysId, ctx.compId,
    ))
  }

  const readback = await fetchFencePoints(ctx, points.length)
  if (readback.size < points.length) {
    const missing = points.length - readback.size
    return {
      success: false,
      resultCode: -1,
      message: `Fence upload unverified: flight controller returned ${readback.size} of ${points.length} points (${missing} missing)`,
    }
  }
  for (let i = 0; i < points.length; i++) {
    const got = readback.get(i)
    if (!got) continue
    if (Math.abs(got.lat - points[i].lat) > FENCE_COORD_EPSILON || Math.abs(got.lon - points[i].lon) > FENCE_COORD_EPSILON) {
      return {
        success: false,
        resultCode: -1,
        message: `Fence upload mismatch at point ${i}: sent ${points[i].lat.toFixed(7)},${points[i].lon.toFixed(7)} but flight controller holds ${got.lat.toFixed(7)},${got.lon.toFixed(7)}`,
      }
    }
  }
  return { success: true, resultCode: 0, message: `Uploaded and verified ${points.length} fence points` }
}

/** ~1.1 cm at the equator — a FENCE_POINT is transported as float32 degrees. */
const FENCE_COORD_EPSILON = 1e-7 * 1000

/** Fetch fence indices `0..total-1` back from the FC. Resolves with whatever
 *  arrived when the deadline expires, so the caller reports a short readback as
 *  an unverified upload rather than as a success. */
function fetchFencePoints(
  ctx: MissionContext,
  total: number,
): Promise<Map<number, { lat: number; lon: number }>> {
  const { promise, resolve } = Promise.withResolvers<Map<number, { lat: number; lon: number }>>()
  const received = new Map<number, { lat: number; lon: number }>()

  const timeout = setTimeout(() => {
    unsub()
    resolve(received)
  }, 10000)

  const unsub = ctx.onFencePoint((data) => {
    if (data.idx < 0 || data.idx >= total) return
    received.set(data.idx, { lat: data.lat, lon: data.lon })
    if (received.size >= total) {
      clearTimeout(timeout)
      unsub()
      resolve(received)
    }
  })

  for (let i = 0; i < total; i++) {
    ctx.transport!.send(encodeFenceFetchPoint(
      ctx.targetSysId, ctx.targetCompId,
      i, ctx.sysId, ctx.compId,
    ))
  }

  return promise
}

export async function downloadFence(ctx: MissionContext): Promise<Array<{ idx: number; lat: number; lon: number }>> {
  if (!ctx.transport?.isConnected) throw new Error('Not connected')

  let fenceTotal: number
  try {
    const result = await ctx.getParameter('FENCE_TOTAL')
    fenceTotal = result.value
  } catch {
    return []
  }

  if (fenceTotal <= 0) return []

  const points: Array<{ idx: number; lat: number; lon: number }> = []
  const received = new Set<number>()

  return new Promise<Array<{ idx: number; lat: number; lon: number }>>((resolve) => {
    const timeout = setTimeout(() => {
      unsub()
      points.sort((a, b) => a.idx - b.idx)
      resolve(points)
    }, 10000)

    const unsub = ctx.onFencePoint((data) => {
      if (!received.has(data.idx)) {
        received.add(data.idx)
        points.push({ idx: data.idx, lat: data.lat, lon: data.lon })
      }
      if (received.size >= fenceTotal) {
        clearTimeout(timeout)
        unsub()
        points.sort((a, b) => a.idx - b.idx)
        resolve(points)
      }
    })

    for (let i = 0; i < fenceTotal; i++) {
      ctx.transport!.send(encodeFenceFetchPoint(
        ctx.targetSysId, ctx.targetCompId,
        i, ctx.sysId, ctx.compId,
      ))
    }
  })
}

/**
 * Upload the geofence as a fence-type mission (mission_type = fence). Used by
 * firmwares (PX4) that store the fence as a mission plan rather than the legacy
 * FENCE_POINT protocol. Kept separate from the waypoint-mission and rally state
 * machines so uploading a fence never touches the waypoint mission.
 */
export async function uploadFenceMission(ctx: MissionContext, elements: FenceElement[]): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) return { success: false, resultCode: -1, message: 'Not connected' }
  const items = encodeFenceMissionItems(elements)
  if (items.length === 0) return { success: true, resultCode: 0, message: 'No fence items to upload' }

  return new Promise<CommandResult>((resolve) => {
    const timer = setTimeout(() => {
      ctx.fenceUpload = null
      resolve({ success: false, resultCode: -1, message: 'Fence upload timed out' })
    }, 15000)

    ctx.fenceUpload = { items, resolve, timer }
    ctx.transport!.send(encodeMissionCount(
      ctx.targetSysId, ctx.targetCompId, items.length,
      ctx.sysId, ctx.compId, MAV_MISSION_TYPE_FENCE,
    ))
  })
}

/**
 * Download the geofence as a fence-type mission (mission_type = fence) and
 * reassemble it into the fence model. Used by firmwares (PX4) that store the
 * fence as a mission plan.
 */
export async function downloadFenceMission(ctx: MissionContext): Promise<FenceElement[]> {
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

  const state: FenceDownloadState = {
    items: new Map(),
    total: 0,
    resolve,
    reject,
    timer: setTimeout(onIdle, TRANSFER_IDLE_TIMEOUT_MS),
    restartTimer: () => {
      clearTimeout(state.timer)
      state.timer = setTimeout(onIdle, TRANSFER_IDLE_TIMEOUT_MS)
    },
  }
  ctx.fenceDownload = state
  ctx.transport.send(encodeMissionRequestList(
    ctx.targetSysId, ctx.targetCompId,
    ctx.sysId, ctx.compId, MAV_MISSION_TYPE_FENCE,
  ))
  return promise
}

export async function uploadRallyPoints(ctx: MissionContext, points: Array<{ lat: number; lon: number; alt: number }>): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) return { success: false, resultCode: -1, message: 'Not connected' }
  if (points.length === 0) return { success: true, resultCode: 0, message: 'No rally points to upload' }

  return new Promise<CommandResult>((resolve) => {
    const timer = setTimeout(() => {
      ctx.rallyUpload = null
      resolve({ success: false, resultCode: -1, message: 'Rally point upload timed out' })
    }, 15000)

    ctx.rallyUpload = { items: points, resolve, timer }
    ctx.transport!.send(encodeMissionCount(
      ctx.targetSysId, ctx.targetCompId, points.length,
      ctx.sysId, ctx.compId, 2,
    ))
  })
}

export async function downloadRallyPoints(ctx: MissionContext): Promise<Array<{ lat: number; lon: number; alt: number }>> {
  if (!ctx.transport?.isConnected) throw new Error('Not connected')

  const { promise, resolve, reject } =
    Promise.withResolvers<Array<{ lat: number; lon: number; alt: number }>>()

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

  const state: RallyDownloadState = {
    items: new Map(),
    total: 0,
    resolve,
    reject,
    timer: setTimeout(onIdle, TRANSFER_IDLE_TIMEOUT_MS),
    restartTimer: () => {
      clearTimeout(state.timer)
      state.timer = setTimeout(onIdle, TRANSFER_IDLE_TIMEOUT_MS)
    },
  }
  ctx.rallyDownload = state
  ctx.transport.send(encodeMissionRequestList(
    ctx.targetSysId, ctx.targetCompId,
    ctx.sysId, ctx.compId, 2,
  ))
  return promise
}
