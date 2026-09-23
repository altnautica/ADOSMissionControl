/**
 * Vehicle info and status message handlers.
 * Each function decodes a MAVLink payload and dispatches to subscriber callbacks.
 *
 * @module protocol/handlers/info-handlers
 */

import type {
  ExtendedSysStateCallback, SystemTimeCallback,
  StatusTextCallback, EventCallback, SerialDataCallback,
  AutopilotVersionCallback, AutopilotVersionData, FirmwareType,
} from '../types'
import {
  decodeExtendedSysState, decodeSystemTime,
  decodeStatustext, decodeEvent, decodeSerialControl,
  decodeAutopilotVersion,
} from '../mavlink-messages'

export function handleExtendedSysState(payload: DataView, callbacks: ExtendedSysStateCallback[]): void {
  const data = decodeExtendedSysState(payload)
  for (const cb of callbacks) {
    cb({ timestamp: Date.now(), vtolState: data.vtolState, landedState: data.landedState })
  }
}

export function handleSystemTime(payload: DataView, callbacks: SystemTimeCallback[]): void {
  const data = decodeSystemTime(payload)
  for (const cb of callbacks) {
    cb({ timestamp: Date.now(), timeUnixUsec: data.timeUnixUsec, timeBootMs: data.timeBootMs })
  }
}

/** How long an unterminated chunk sequence waits for its next chunk before it is emitted as received. */
export const STATUSTEXT_CHUNK_TIMEOUT_MS = 1000

interface PendingStatusText {
  severity: number
  chunks: string[]
  timer: ReturnType<typeof setTimeout>
}

/**
 * Reassembles STATUSTEXT chunk sequences into whole messages.
 *
 * A message longer than the 50-char field is sent as several STATUSTEXT
 * frames sharing a non-zero `id`, indexed by `chunk_seq`; the chunk whose
 * text ends with a NUL is the last. `id` 0 is a complete single-chunk
 * message. A sequence whose last chunk never arrives is emitted as received
 * after {@link STATUSTEXT_CHUNK_TIMEOUT_MS}, so nothing is silently dropped.
 */
export class StatusTextAssembler {
  private pending = new Map<string, PendingStatusText>()

  push(
    sender: { systemId: number; componentId: number },
    payload: DataView,
    callbacks: StatusTextCallback[],
  ): void {
    const st = decodeStatustext(payload)
    if (st.id === 0) {
      for (const cb of callbacks) cb({ severity: st.severity, text: st.text })
      return
    }
    const key = `${sender.systemId}:${sender.componentId}:${st.id}`
    let entry = this.pending.get(key)
    if (!entry) {
      entry = {
        severity: st.severity,
        chunks: [],
        timer: setTimeout(() => this.flush(key, callbacks), STATUSTEXT_CHUNK_TIMEOUT_MS),
      }
      this.pending.set(key, entry)
    }
    entry.chunks[st.chunkSeq] = st.text
    if (st.terminated) this.flush(key, callbacks)
  }

  /** Drop every partial sequence (on disconnect). */
  clear(): void {
    for (const entry of this.pending.values()) clearTimeout(entry.timer)
    this.pending.clear()
  }

  private flush(key: string, callbacks: StatusTextCallback[]): void {
    const entry = this.pending.get(key)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(key)
    // A lost middle chunk leaves a hole; join what arrived, in order.
    const text = entry.chunks.filter((c) => c !== undefined).join('')
    for (const cb of callbacks) cb({ severity: entry.severity, text })
  }
}

export function handleEvent(payload: DataView, callbacks: EventCallback[]): void {
  const ev = decodeEvent(payload)
  for (const cb of callbacks) cb(ev)
}

export function handleSerialControl(payload: DataView, callbacks: SerialDataCallback[]): void {
  const sc = decodeSerialControl(payload)
  for (const cb of callbacks) {
    cb({ device: sc.device, data: sc.data })
  }
}

/**
 * AP_FW_BOARD_ID carried in AUTOPILOT_VERSION.board_version. ArduPilot puts the
 * board's APJ_BOARD_ID in the upper 16 bits; other firmware does not encode a
 * board id there, so it yields undefined.
 */
export function decodeBoardId(boardVersion: number, firmwareType: FirmwareType | undefined): number | undefined {
  if (!firmwareType?.startsWith('ardupilot-')) return undefined
  const id = boardVersion >>> 16
  return id > 0 ? id : undefined
}

export function handleAutopilotVersion(
  payload: DataView,
  callbacks: AutopilotVersionCallback[],
  firmwareType: FirmwareType | undefined,
): AutopilotVersionData {
  const raw = decodeAutopilotVersion(payload)
  const data: AutopilotVersionData = {
    capabilities: raw.capabilities,
    flightSwVersion: raw.flightSwVersion,
    middlewareSwVersion: raw.middlewareSwVersion,
    osSwVersion: raw.osSwVersion,
    boardVersion: raw.boardVersion,
    boardId: decodeBoardId(raw.boardVersion, firmwareType),
    uid: raw.uid,
  }
  for (const cb of callbacks) cb(data)
  return data
}
