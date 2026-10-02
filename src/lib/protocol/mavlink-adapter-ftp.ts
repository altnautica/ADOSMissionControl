/**
 * MAVLink adapter: read-only FILE_TRANSFER_PROTOCOL session client.
 *
 * Implements the file-read half of MAVLink FTP as a session state machine that
 * mirrors the log-download client: open a file, stream its contents with burst
 * reads (appending each chunk at its reported offset, re-reading any hole),
 * check the server CRC-32 when the server offers one, then terminate the
 * session. A read that cannot be completed or fails the CRC check rejects.
 *
 * The agent is a transparent MAVLink pipe, so this runs entirely in the GCS.
 *
 * @module protocol/mavlink-adapter-ftp
 */

import type { Transport, FtpDownloadProgressCallback } from './types'
import { encodeFileTransferProtocol, FTP_MAX_DATA } from './mavlink-encoder'
import { decodeFileTransferProtocol, FtpOpcode, FtpError, ftpErrorName } from './mavlink-messages'
import type { MAVLinkFrame } from './mavlink-parser'

const INACTIVITY_MS = 3000
const HARD_TIMEOUT_MS = 5 * 60 * 1000
const MAX_RETRIES = 5
/** Never pre-allocate more than this on a server-reported size; the read loop
 *  grows the buffer as data actually arrives, so a garbage/huge size field can
 *  never force a multi-GB allocation before a single byte is received. */
const MAX_PREALLOC = 64 * 1024 * 1024

type FtpPhase = 'opening' | 'reading' | 'crc' | 'terminating'

export interface FtpSessionState {
  path: string
  phase: FtpPhase
  /** FTP session id (0 until OpenFileRO establishes one). */
  session: number
  /** Sequence number to place on the next new request. */
  seq: number
  /** Reported file size from OpenFileRO (0 = unknown). */
  fileSize: number
  data: Uint8Array
  /** Highest CONTIGUOUS byte received; a gap (lost/reordered chunk) does not
   *  advance it, so the next request re-fetches the hole instead of leaving it
   *  zero-filled. */
  receivedBytes: number
  /** Furthest byte any data chunk reached. Above `receivedBytes` means a hole
   *  below it is still missing, so the file is not complete. */
  highestEnd: number
  /** True once any read ACK arrived; until then silence is not an empty file. */
  dataAcked: boolean
  /** receivedBytes at the previous burst-window completion; used to bound
   *  consecutive no-progress bursts. */
  lastCompleteBytes: number
  /** Consecutive burst completions that made no progress. */
  stallCount: number
  /** Server CRC-32 captured from CalcFileCRC32 (advisory). */
  fileCrc: number | null
  onProgress?: FtpDownloadProgressCallback
  resolve: (data: Uint8Array) => void
  reject: (err: Error) => void
  /** Last request frame, resent verbatim on inactivity (spec-correct resend). */
  lastRequest: Uint8Array | null
  inactivityTimer: ReturnType<typeof setTimeout> | null
  hardTimer: ReturnType<typeof setTimeout>
  retryCount: number
}

export interface FtpContext {
  transport: Transport | null
  targetSysId: number
  targetCompId: number
  sysId: number
  compId: number
  ftpDownload: FtpSessionState | null
  /** Active write/list/remove op (see mavlink-adapter-ftp-ops.ts). A read
   *  download and a write op are mutually exclusive on one context. */
  ftpOp?: import('./mavlink-adapter-ftp-ops').FtpOpState | null
}

/** Standard IEEE 802.3 (zlib) CRC-32 over a byte range, reflected poly. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]
    for (let b = 0; b < 8; b++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0xedb88320) : (crc >>> 1)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function clearTimers(st: FtpSessionState): void {
  if (st.inactivityTimer) { clearTimeout(st.inactivityTimer); st.inactivityTimer = null }
  clearTimeout(st.hardTimer)
}

/** Send a request frame, record it for resend, and stamp the seq. */
function sendRequest(ctx: FtpContext, frame: Uint8Array): void {
  const st = ctx.ftpDownload
  if (!st) return
  st.lastRequest = frame
  st.seq = (st.seq + 1) & 0xffff
  ctx.transport?.send(frame)
  armInactivity(ctx)
}

function buildOpenFileRO(ctx: FtpContext, path: string): Uint8Array {
  const st = ctx.ftpDownload!
  const pathBytes = new TextEncoder().encode(path)
  return encodeFileTransferProtocol(
    ctx.targetSysId, ctx.targetCompId,
    0, FtpOpcode.OpenFileRO, st.seq, 0,
    Math.min(pathBytes.length, FTP_MAX_DATA), pathBytes,
    ctx.sysId, ctx.compId,
  )
}

function buildBurstRead(ctx: FtpContext): Uint8Array {
  const st = ctx.ftpDownload!
  return encodeFileTransferProtocol(
    ctx.targetSysId, ctx.targetCompId,
    st.session, FtpOpcode.BurstReadFile, st.seq, st.receivedBytes,
    FTP_MAX_DATA, new Uint8Array(0),
    ctx.sysId, ctx.compId,
  )
}

function buildCalcCrc(ctx: FtpContext): Uint8Array {
  const st = ctx.ftpDownload!
  return encodeFileTransferProtocol(
    ctx.targetSysId, ctx.targetCompId,
    st.session, FtpOpcode.CalcFileCRC32, st.seq, 0,
    0, new Uint8Array(0),
    ctx.sysId, ctx.compId,
  )
}

function buildTerminate(ctx: FtpContext): Uint8Array {
  const st = ctx.ftpDownload!
  return encodeFileTransferProtocol(
    ctx.targetSysId, ctx.targetCompId,
    st.session, FtpOpcode.TerminateSession, st.seq, 0,
    0, new Uint8Array(0),
    ctx.sysId, ctx.compId,
  )
}

/** (Re)arm the inactivity timer for the current phase. */
function armInactivity(ctx: FtpContext): void {
  const st = ctx.ftpDownload
  if (!st) return
  if (st.inactivityTimer) clearTimeout(st.inactivityTimer)
  st.inactivityTimer = setTimeout(() => onInactivity(ctx), INACTIVITY_MS)
}

function onInactivity(ctx: FtpContext): void {
  const st = ctx.ftpDownload
  if (!st || !ctx.transport?.isConnected) return

  // The teardown phases are best-effort: if the server stops answering a
  // CalcFileCRC32 or TerminateSession, resolve with what we already read
  // rather than retry forever.
  if (st.phase === 'crc' || st.phase === 'terminating') {
    finishFtp(ctx)
    return
  }

  st.retryCount++
  if (st.retryCount > MAX_RETRIES) {
    if (st.phase === 'opening') {
      // No session was ever established: an FC without FTP, or a lost open.
      failFtp(ctx, new Error(`FTP open of ${st.path} got no reply`))
    } else if (isIncomplete(st) || !st.dataAcked) {
      failFtp(ctx, new Error(`FTP read timed out at ${st.receivedBytes}${st.fileSize > 0 ? `/${st.fileSize}` : ''} bytes`))
    } else {
      // Unknown size, every byte contiguous, and no more data arriving: what
      // we have is the file.
      finishReading(ctx)
    }
    return
  }
  if (st.lastRequest) {
    ctx.transport.send(st.lastRequest)
    armInactivity(ctx)
  }
}

/** Data is still missing: short of the reported size, or a hole below a later chunk. */
function isIncomplete(st: FtpSessionState): boolean {
  return (st.fileSize > 0 && st.receivedBytes < st.fileSize) || st.highestEnd > st.receivedBytes
}

/**
 * Ask for the next burst at the contiguous frontier, bounding consecutive
 * rounds that gain nothing so a server that never fills a hole fails the read
 * instead of hammering it for the whole hard timeout.
 */
function rerequestFromFrontier(ctx: FtpContext, st: FtpSessionState): void {
  if (st.receivedBytes > st.lastCompleteBytes) {
    st.lastCompleteBytes = st.receivedBytes
    st.stallCount = 0
  } else if (++st.stallCount > MAX_RETRIES) {
    if (isIncomplete(st)) {
      failFtp(ctx, new Error(`FTP read stalled at ${st.receivedBytes}${st.fileSize > 0 ? `/${st.fileSize}` : ''} bytes`))
    } else {
      finishReading(ctx)
    }
    return
  }
  sendRequest(ctx, buildBurstRead(ctx))
}

function ensureCapacity(st: FtpSessionState, end: number): void {
  if (end <= st.data.length) return
  const grown = new Uint8Array(Math.max(end, st.data.length * 2, 512))
  grown.set(st.data)
  st.data = grown
}

/** Transition into the advisory CRC-verify phase (or straight to terminate). */
function finishReading(ctx: FtpContext): void {
  const st = ctx.ftpDownload
  if (!st) return
  st.phase = 'crc'
  st.retryCount = 0
  sendRequest(ctx, buildCalcCrc(ctx))
}

/** Send TerminateSession then resolve the accumulated file. */
function finishFtp(ctx: FtpContext): void {
  const st = ctx.ftpDownload
  if (!st) return
  clearTimers(st)
  const wasTerminating = st.phase === 'terminating'
  const result = st.data.slice(0, st.receivedBytes)
  st.phase = 'terminating'
  if (!wasTerminating && ctx.transport?.isConnected) {
    // Fire the terminate but do not wait on its ACK; resolve immediately.
    ctx.transport.send(buildTerminate(ctx))
  }
  ctx.ftpDownload = null
  st.resolve(result)
}

function failFtp(ctx: FtpContext, err: Error): void {
  const st = ctx.ftpDownload
  if (!st) return
  clearTimers(st)
  if (ctx.transport?.isConnected && st.session !== 0) {
    ctx.transport.send(buildTerminate(ctx))
  }
  ctx.ftpDownload = null
  st.reject(err)
}

/**
 * Start a read-only FTP download of `path`. Resolves with the raw file bytes.
 */
export async function downloadFileViaFtp(
  ctx: FtpContext,
  path: string,
  onProgress?: FtpDownloadProgressCallback,
): Promise<Uint8Array> {
  if (!ctx.transport?.isConnected) throw new Error('Not connected')
  if (ctx.ftpDownload || ctx.ftpOp) throw new Error('An FTP operation is already in progress')

  return new Promise<Uint8Array>((resolve, reject) => {
    const hardTimer = setTimeout(() => {
      failFtp(ctx, new Error('FTP download exceeded the hard timeout'))
    }, HARD_TIMEOUT_MS)

    ctx.ftpDownload = {
      path, phase: 'opening', session: 0, seq: 0,
      fileSize: 0, data: new Uint8Array(0), receivedBytes: 0, highestEnd: 0, dataAcked: false,
      lastCompleteBytes: 0, stallCount: 0, fileCrc: null,
      onProgress, resolve, reject,
      lastRequest: null, inactivityTimer: null, hardTimer, retryCount: 0,
    }

    sendRequest(ctx, buildOpenFileRO(ctx, path))
  })
}

/** Cancel an in-progress FTP download, terminating the session. */
export function cancelFtp(ctx: FtpContext): void {
  const st = ctx.ftpDownload
  if (!st) return
  clearTimers(st)
  if (ctx.transport?.isConnected && st.session !== 0) {
    ctx.transport.send(buildTerminate(ctx))
  }
  ctx.ftpDownload = null
  st.resolve(st.data.slice(0, st.receivedBytes))
}

/**
 * Handle an inbound FILE_TRANSFER_PROTOCOL frame (ACK or NAK) for the active
 * session. Non-ACK/NAK frames and frames for a different session are ignored.
 */
export function handleFileTransferProtocolAck(ctx: FtpContext, frame: MAVLinkFrame): void {
  const st = ctx.ftpDownload
  if (!st) return
  const m = decodeFileTransferProtocol(frame.payload)

  if (m.opcode !== FtpOpcode.Ack && m.opcode !== FtpOpcode.Nak) return

  // Once past the opening handshake, ignore responses for a different session.
  // OpenFileRO is answered while the session is still being assigned (and the
  // assigned id may legitimately be 0), so the opening phase is exempt; after
  // that an exact session match is required. Gating on the phase rather than on
  // "session != 0" keeps the filter effective when the established session is 0.
  if (st.phase !== 'opening' && m.session !== st.session) return

  st.retryCount = 0
  armInactivity(ctx)

  if (m.opcode === FtpOpcode.Nak) {
    const code = m.size >= 1 ? m.data[0] : FtpError.Fail
    if (code === FtpError.EndOfFile && st.phase === 'reading') {
      // Both ArduPilot and PX4 end every burst with an EOF NAK, including a
      // burst that lost a packet. A hole below received data is always
      // re-read. Short of the reported size with no hole, read once more from
      // the frontier: an EOF that brings nothing new there is the real end.
      if (st.highestEnd > st.receivedBytes) {
        rerequestFromFrontier(ctx, st)
      } else if (st.fileSize > 0 && st.receivedBytes < st.fileSize && st.receivedBytes > st.lastCompleteBytes) {
        st.lastCompleteBytes = st.receivedBytes
        st.stallCount = 0
        sendRequest(ctx, buildBurstRead(ctx))
      } else {
        finishReading(ctx)
      }
      return
    }
    if (st.phase === 'crc') {
      // Server declined the CRC check (unsupported or error), so skip it.
      finishFtp(ctx)
      return
    }
    if (st.phase === 'terminating') {
      finishFtp(ctx)
      return
    }
    failFtp(ctx, new Error(`FTP NAK (${ftpErrorName(code)}) on ${st.path}`))
    return
  }

  // ACK path: dispatch on the request being acknowledged.
  switch (m.reqOpcode) {
    case FtpOpcode.OpenFileRO: {
      st.session = m.session
      st.phase = 'reading'
      st.receivedBytes = 0
      if (m.size >= 4) {
        const dv = new DataView(m.data.buffer, m.data.byteOffset, m.data.byteLength)
        st.fileSize = dv.getUint32(0, true)
        // Bound the pre-allocation; the read loop grows the buffer as data
        // arrives, so an implausible reported size can't force a huge alloc.
        ensureCapacity(st, Math.min(st.fileSize, MAX_PREALLOC))
      } else {
        st.fileSize = 0
      }
      sendRequest(ctx, buildBurstRead(ctx))
      return
    }
    case FtpOpcode.BurstReadFile:
    case FtpOpcode.ReadFile: {
      if (st.phase !== 'reading') return
      st.dataAcked = true
      const count = Math.min(m.size, FTP_MAX_DATA)
      if (count > 0) {
        const end = m.offset + count
        ensureCapacity(st, end)
        st.data.set(m.data.subarray(0, count), m.offset)
        st.highestEnd = Math.max(st.highestEnd, end)
        // Advance the received marker only across contiguous data. A chunk that
        // begins beyond the marker means an earlier chunk was lost or reordered;
        // its bytes are still stored, but the marker stays at the gap so the next
        // burst request re-fetches the hole rather than silently zero-filling it.
        if (m.offset <= st.receivedBytes && end > st.receivedBytes) {
          st.receivedBytes = end
        }
      }
      if (st.onProgress) st.onProgress(st.receivedBytes, st.fileSize)

      if (st.fileSize > 0 && st.receivedBytes >= st.fileSize) {
        finishReading(ctx)
        return
      }
      // A completed burst window with more file to read needs a fresh request.
      if (m.burstComplete === 1) rerequestFromFrontier(ctx, st)
      // Otherwise the server keeps streaming this burst; keep receiving.
      return
    }
    case FtpOpcode.CalcFileCRC32: {
      if (m.size >= 4) {
        const dv = new DataView(m.data.buffer, m.data.byteOffset, m.data.byteLength)
        st.fileCrc = dv.getUint32(0, true)
        const local = crc32(st.data.slice(0, st.receivedBytes))
        if (local !== st.fileCrc) {
          failFtp(ctx, new Error(`FTP CRC-32 mismatch on ${st.path}: server=${st.fileCrc.toString(16)} local=${local.toString(16)}`))
          return
        }
      }
      finishFtp(ctx)
      return
    }
    case FtpOpcode.TerminateSession: {
      finishFtp(ctx)
      return
    }
    default:
      return
  }
}
