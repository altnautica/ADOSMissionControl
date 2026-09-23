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

export function handleStatusText(payload: DataView, callbacks: StatusTextCallback[]): void {
  const st = decodeStatustext(payload)
  for (const cb of callbacks) cb(st)
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
