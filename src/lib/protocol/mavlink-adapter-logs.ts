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

export interface LogDataState {
  logId: number
  /** LOG_DATA carries no total, so the adapter never knows it: always 0 (unknown). */
  totalSize: number
  data: Uint8Array
  receivedBytes: number
  lastReceivedOfs: number
  onProgress?: LogDownloadProgressCallback
  resolve: (data: Uint8Array) => void
  reject: (err: Error) => void
  inactivityTimer: ReturnType<typeof setTimeout> | null
  hardTimer: ReturnType<typeof setTimeout>
  retryCount: number
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

export async function downloadLog(ctx: LogContext, logId: number, onProgress?: LogDownloadProgressCallback): Promise<Uint8Array> {
  if (!ctx.transport?.isConnected) throw new Error('Not connected')

  return new Promise<Uint8Array>((resolve, reject) => {
    // LOG_DATA has no end marker other than a short packet, so a download
    // that has not seen one when a timer fires is incomplete and rejects.
    const hardTimer = setTimeout(() => {
      finishLogDataDownload(ctx, true)
    }, 5 * 60 * 1000)

    const createInactivityTimer = () => setTimeout(() => {
      if (!ctx.logDataDownload || !ctx.transport?.isConnected) return
      ctx.logDataDownload.retryCount++
      if (ctx.logDataDownload.retryCount > 5) {
        finishLogDataDownload(ctx, true)
        return
      }
      ctx.transport.send(encodeLogRequestData(
        ctx.targetSysId, ctx.targetCompId,
        ctx.logDataDownload.logId,
        ctx.logDataDownload.receivedBytes,
        0xffffffff, ctx.sysId, ctx.compId,
      ))
      ctx.logDataDownload.inactivityTimer = createInactivityTimer()
    }, 3000)

    ctx.logDataDownload = {
      logId, totalSize: 0, data: new Uint8Array(0),
      receivedBytes: 0, lastReceivedOfs: -1,
      onProgress, resolve, reject,
      inactivityTimer: createInactivityTimer(),
      hardTimer, retryCount: 0,
    }

    ctx.transport!.send(encodeLogRequestData(
      ctx.targetSysId, ctx.targetCompId,
      logId, 0, 0xffffffff, ctx.sysId, ctx.compId,
    ))
  })
}

export async function eraseAllLogs(ctx: LogContext): Promise<CommandResult> {
  if (!ctx.transport?.isConnected) {
    return { success: false, resultCode: -1, message: 'Not connected' }
  }
  ctx.transport.send(encodeLogErase(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId))
  return { success: true, resultCode: 0, message: 'Erase command sent' }
}

/** Abort the active log download; its promise rejects with "Log download cancelled". */
export function cancelLogDownload(ctx: LogContext): void {
  if (ctx.logDataDownload) {
    clearTimeout(ctx.logDataDownload.inactivityTimer ?? undefined)
    clearTimeout(ctx.logDataDownload.hardTimer)
    ctx.logDataDownload.reject(new Error('Log download cancelled'))
    ctx.logDataDownload = null
  }
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
  if (!ctx.logDataDownload) return
  const data = decodeLogData(frame.payload)
  if (data.id !== ctx.logDataDownload.logId) return

  const endOfs = data.ofs + data.count
  if (endOfs > ctx.logDataDownload.data.length) {
    const newBuf = new Uint8Array(Math.max(endOfs, ctx.logDataDownload.data.length * 2))
    newBuf.set(ctx.logDataDownload.data)
    ctx.logDataDownload.data = newBuf
  }

  ctx.logDataDownload.data.set(data.data, data.ofs)
  if (endOfs > ctx.logDataDownload.receivedBytes) {
    ctx.logDataDownload.receivedBytes = endOfs
  }
  ctx.logDataDownload.lastReceivedOfs = data.ofs

  // totalSize is 0 (unknown): the caller scales progress against the
  // LOG_ENTRY size it listed.
  ctx.logDataDownload.onProgress?.(ctx.logDataDownload.receivedBytes, ctx.logDataDownload.totalSize)

  if (ctx.logDataDownload.inactivityTimer) clearTimeout(ctx.logDataDownload.inactivityTimer)
  ctx.logDataDownload.inactivityTimer = setTimeout(() => {
    if (!ctx.logDataDownload || !ctx.transport?.isConnected) return
    ctx.logDataDownload.retryCount++
    if (ctx.logDataDownload.retryCount > 5) {
      finishLogDataDownload(ctx, true)
      return
    }
    ctx.transport.send(encodeLogRequestData(
      ctx.targetSysId, ctx.targetCompId,
      ctx.logDataDownload.logId,
      ctx.logDataDownload.receivedBytes,
      0xffffffff, ctx.sysId, ctx.compId,
    ))
  }, 3000)

  if (data.count < 90) {
    finishLogDataDownload(ctx, false)
  }
}

/**
 * End the active download. A complete download (short final packet)
 * resolves with the bytes; an incomplete one (hard timer or retries
 * exhausted) rejects, so a truncated log is never handed on as a whole one.
 */
export function finishLogDataDownload(ctx: LogContext, partial: boolean): void {
  if (!ctx.logDataDownload) return
  const dl = ctx.logDataDownload
  clearTimeout(dl.inactivityTimer ?? undefined)
  clearTimeout(dl.hardTimer)
  ctx.logDataDownload = null
  if (partial) {
    dl.reject(new Error(`Log ${dl.logId} download incomplete: the flight controller stopped sending after ${dl.receivedBytes} bytes`))
  } else {
    dl.resolve(dl.data.slice(0, dl.receivedBytes))
  }
  if (ctx.transport?.isConnected) {
    ctx.transport.send(encodeLogRequestEnd(ctx.targetSysId, ctx.targetCompId, ctx.sysId, ctx.compId))
  }
}
