/**
 * MAVLink adapter — log download protocol methods.
 *
 * getLogList, downloadLog, eraseAllLogs, cancelLogDownload,
 * and internal log state machine handlers.
 *
 * @module protocol/mavlink-adapter-logs
 */

import type { Transport, CommandResult, LogEntry, LogDownloadProgressCallback } from './types'
import {
  encodeLogRequestList, encodeLogRequestData, encodeLogErase, encodeLogRequestEnd,
} from './mavlink-encoder'
import { decodeLogEntry, decodeLogData } from './mavlink-messages'
import type { MAVLinkFrame } from './mavlink-parser'

export interface LogListState {
  entries: Map<number, LogEntry>
  lastLogId: number
  resolve: (entries: LogEntry[]) => void
  timer: ReturnType<typeof setTimeout>
}

/** LOG_DATA payload size; a shorter packet marks the end of the log. */
const LOG_DATA_CHUNK = 90
/** Silence before the missing range is requested again. */
const LOG_DATA_IDLE_MS = 3000
/** Consecutive silent re-requests before the download is declared incomplete. */
const LOG_DATA_MAX_RETRIES = 5

/** A byte range below the received frontier that no LOG_DATA has covered yet. */
interface LogDataGap {
  start: number
  end: number
}

export interface LogDataState {
  logId: number
  data: Uint8Array
  /** Highest byte offset seen (end of the furthest packet). */
  receivedBytes: number
  /** Ranges below `receivedBytes` lost in transit, in offset order. */
  gaps: LogDataGap[]
  /** Log length, known once the short end-of-log packet has arrived. */
  endBytes: number | null
  /** The lost range last requested again, while it is being served. */
  pendingGap: LogDataGap | null
  onProgress?: LogDownloadProgressCallback
  resolve: (data: Uint8Array) => void
  reject: (err: Error) => void
  inactivityTimer: ReturnType<typeof setTimeout> | null
  /** Consecutive re-requests with no data in between. */
  retryCount: number
  /** Set once resolved, rejected or cancelled; later frames and timers are ignored. */
  settled: boolean
}

export interface LogContext {
  transport: Transport | null
  targetSysId: number
  targetCompId: number
  sysId: number
  compId: number
  logListDownload: LogListState | null
  logDataDownload: LogDataState | null
}

export async function getLogList(ctx: LogContext): Promise<LogEntry[]> {
  if (!ctx.transport?.isConnected) return []

  return new Promise<LogEntry[]>((resolve) => {
    const timer = setTimeout(() => {
      if (ctx.logListDownload) {
        const entries = Array.from(ctx.logListDownload.entries.values())
          .sort((a, b) => a.id - b.id)
        ctx.logListDownload = null
        resolve(entries)
      } else {
        resolve([])
      }
    }, 15000)

    ctx.logListDownload = { entries: new Map(), lastLogId: 0, resolve, timer }

    ctx.transport!.send(encodeLogRequestList(
      ctx.targetSysId, ctx.targetCompId,
      0, 0xffff, ctx.sysId, ctx.compId,
    ))
  })
}

/**
 * Download one onboard log over LOG_REQUEST_DATA / LOG_DATA.
 *
 * LOG_DATA carries no total and no end marker other than a short packet, so
 * the download resolves only once that packet has arrived AND every range a
 * lost packet left behind has been requested again and filled. A stall with
 * no data for {@link LOG_DATA_MAX_RETRIES} re-requests rejects as incomplete:
 * a truncated or holed log is never handed on as a whole one. A download that
 * keeps receiving data has no wall-clock limit.
 */
export async function downloadLog(ctx: LogContext, logId: number, onProgress?: LogDownloadProgressCallback): Promise<Uint8Array> {
  if (!ctx.transport?.isConnected) throw new Error('Not connected')
  if (ctx.logDataDownload) {
    settleLogDataDownload(ctx, ctx.logDataDownload, new Error('Log download superseded by another download'))
  }

  const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>()
  const dl: LogDataState = {
    logId, data: new Uint8Array(0),
    receivedBytes: 0, gaps: [], endBytes: null, pendingGap: null,
    onProgress, resolve, reject,
    inactivityTimer: null, retryCount: 0, settled: false,
  }
  ctx.logDataDownload = dl
  requestMissing(ctx, dl)
  armInactivityTimer(ctx, dl)
  return promise
}

/**
 * Ask for what is still missing: past the frontier while the end is unknown,
 * then each lost range in turn once the end-of-log packet has arrived.
 */
function requestMissing(ctx: LogContext, dl: LogDataState): void {
  const gap = dl.endBytes !== null ? dl.gaps[0] : undefined
  dl.pendingGap = gap ? { ...gap } : null
  if (!ctx.transport?.isConnected) return
  ctx.transport.send(encodeLogRequestData(
    ctx.targetSysId, ctx.targetCompId, dl.logId,
    gap ? gap.start : dl.receivedBytes,
    gap ? gap.end - gap.start : 0xffffffff,
    ctx.sysId, ctx.compId,
  ))
}

function armInactivityTimer(ctx: LogContext, dl: LogDataState): void {
  clearTimeout(dl.inactivityTimer ?? undefined)
  dl.inactivityTimer = setTimeout(() => {
    if (dl.settled) return
    dl.retryCount++
    if (dl.retryCount > LOG_DATA_MAX_RETRIES) {
      settleLogDataDownload(ctx, dl, new Error(incompleteMessage(dl)))
      return
    }
    requestMissing(ctx, dl)
    armInactivityTimer(ctx, dl)
  }, LOG_DATA_IDLE_MS)
}

function incompleteMessage(dl: LogDataState): string {
  if (dl.endBytes === null) {
    return `Log ${dl.logId} download incomplete: the flight controller stopped sending after ${dl.receivedBytes} bytes`
  }
  const missing = dl.gaps.reduce((sum, g) => sum + (g.end - g.start), 0)
  return `Log ${dl.logId} download incomplete: ${missing} of ${dl.endBytes} bytes never arrived`
}

/** Remove [start, end) from the gap list, splitting a gap it lands inside. */
function fillGaps(gaps: LogDataGap[], start: number, end: number): LogDataGap[] {
  const out: LogDataGap[] = []
  for (const g of gaps) {
    if (g.end <= start || g.start >= end) {
      out.push(g)
      continue
    }
    if (g.start < start) out.push({ start: g.start, end: start })
    if (end < g.end) out.push({ start: end, end: g.end })
  }
  return out
}

/**
 * Settle the download once: resolve with the complete log, or reject with
 * `error`. Later frames and timers see `settled` and do nothing, whichever
 * context object they hold.
 */
function settleLogDataDownload(ctx: LogContext, dl: LogDataState, error: Error | null): void {
  if (dl.settled) return
  dl.settled = true
  clearTimeout(dl.inactivityTimer ?? undefined)
  dl.inactivityTimer = null
  if (ctx.logDataDownload === dl) ctx.logDataDownload = null
  if (error) dl.reject(error)
  else dl.resolve(dl.data.slice(0, dl.endBytes ?? dl.receivedBytes))
  if (ctx.transport?.isConnected) {
    ctx.transport.send(encodeLogRequestEnd(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId))
  }
}

export async function eraseAllLogs(ctx: LogContext): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  ctx.transport.send(encodeLogErase(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId))
  return { success: true, resultCode: 0, message: 'Erase command sent' }
}

/** Abort the active log download; its promise rejects with `reason`. */
export function cancelLogDownload(ctx: LogContext, reason = 'Log download cancelled'): void {
  const dl = ctx.logDataDownload
  if (dl && !dl.settled) {
    settleLogDataDownload(ctx, dl, new Error(reason))
    return
  }
  ctx.logDataDownload = null
  if (ctx.transport?.isConnected) {
    ctx.transport.send(encodeLogRequestEnd(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId))
  }
}

export function handleLogEntry(ctx: LogContext, frame: MAVLinkFrame): void {
  if (!ctx.logListDownload) return
  const data = decodeLogEntry(frame.payload)
  const entry: LogEntry = {
    id: data.id,
    numLogs: data.numLogs,
    lastLogId: data.lastLogNum,
    size: data.size,
    timeUtc: data.timeUtc,
  }
  ctx.logListDownload.entries.set(data.id, entry)
  ctx.logListDownload.lastLogId = data.lastLogNum

  if (data.id >= data.lastLogNum || data.numLogs === 0) {
    clearTimeout(ctx.logListDownload.timer)
    const entries = Array.from(ctx.logListDownload.entries.values())
      .sort((a, b) => a.id - b.id)
    ctx.logListDownload.resolve(entries)
    ctx.logListDownload = null
  }
}

export function handleLogData(ctx: LogContext, frame: MAVLinkFrame): void {
  const dl = ctx.logDataDownload
  if (!dl || dl.settled) return
  const data = decodeLogData(frame.payload)
  if (data.id !== dl.logId) return

  const endOfs = data.ofs + data.count
  if (endOfs > dl.data.length) {
    const newBuf = new Uint8Array(Math.max(endOfs, dl.data.length * 2))
    newBuf.set(dl.data)
    dl.data = newBuf
  }
  dl.data.set(data.data, data.ofs)

  // A packet beyond the frontier means the ones between were lost; a packet
  // behind it fills (part of) such a hole.
  if (data.ofs > dl.receivedBytes) dl.gaps.push({ start: dl.receivedBytes, end: data.ofs })
  else if (data.ofs < dl.receivedBytes) dl.gaps = fillGaps(dl.gaps, data.ofs, endOfs)
  if (endOfs >= dl.receivedBytes) {
    dl.receivedBytes = endOfs
    if (data.count < LOG_DATA_CHUNK) dl.endBytes = endOfs
  }
  dl.retryCount = 0

  // LOG_DATA carries no total: the caller scales progress against the
  // LOG_ENTRY size it listed.
  dl.onProgress?.(dl.receivedBytes, 0)

  if (dl.endBytes !== null) {
    if (dl.gaps.length === 0) {
      settleLogDataDownload(ctx, dl, null)
      return
    }
    // Ask for the next hole once the one last requested has been filled.
    const pending = dl.pendingGap
    if (!pending || !dl.gaps.some((g) => g.start < pending.end && g.end > pending.start)) {
      requestMissing(ctx, dl)
    }
  }
  armInactivityTimer(ctx, dl)
}
