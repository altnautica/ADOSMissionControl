/**
 * MAVLink adapter — EKF source-set switching, CAN passthrough and the PX4
 * actuator test.
 *
 * @module protocol/mavlink-adapter-ext-commands
 */

import type { CommandResult, FirmwareHandler } from './types'
import { MAV_CMD_SET_EKF_SOURCE_SET } from './encoders'
import { MAV_CMD_CAN_FORWARD, encodeCanFrame, encodeCanFdFrame } from './encoders/can-forward'

export interface ExtCommandContext {
  firmwareHandler: FirmwareHandler | null
  targetSysId: number
  targetCompId: number
  sysId: number
  compId: number
  /** True while the primary link is up. */
  linkUp: boolean
  sendCommandLong: (cmd: number, p: [number, number, number, number, number, number, number], timeout?: number) => Promise<CommandResult>
  /** Fire-and-forget send; a send failure is logged, never thrown. */
  sendHousekeeping: (frame: Uint8Array) => void
}

export type EkfSourceSetResult = { ok: true } | { ok: false; reason: 'px4-not-supported' | 'no-ack' | 'rejected' }

/**
 * Switch the active EKF source set at runtime.
 *
 * ArduPilot path: COMMAND_LONG with MAV_CMD_SET_EKF_SOURCE_SET (42007) and
 * a 1 s ACK timeout. PX4 has no runtime equivalent; the autopilot requires
 * a parameter update plus EKF restart, which is out of scope for this
 * surface, so the call resolves with a typed rejection instead of throwing.
 * `onPx4` runs on that rejection (the adapter warns once).
 */
export async function setEkfSourceSet(c: ExtCommandContext, sourceSet: 1 | 2 | 3, onPx4: () => void): Promise<EkfSourceSetResult> {
  if (sourceSet !== 1 && sourceSet !== 2 && sourceSet !== 3) {
    throw new TypeError(`setEkfSourceSet: sourceSet must be 1, 2, or 3 (received ${String(sourceSet)})`)
  }
  if (c.firmwareHandler?.firmwareType === 'px4') {
    onPx4()
    return { ok: false, reason: 'px4-not-supported' }
  }
  const result = await c.sendCommandLong(MAV_CMD_SET_EKF_SOURCE_SET, [sourceSet, 0, 0, 0, 0, 0, 0], 1000)
  if (result.success) return { ok: true }
  if (result.resultCode === -1) return { ok: false, reason: 'no-ack' }
  return { ok: false, reason: 'rejected' }
}

/** Send a CAN_FRAME (386) or CANFD_FRAME (387) over the active link. Fire-and-forget. */
export function sendCanFrame(c: ExtCommandContext, bus: number, id: number, data: Uint8Array, fd: boolean): void {
  if (!c.linkUp) return
  const can = { id, extended: (id & 0x80000000) !== 0, dlc: data.length, data }
  c.sendHousekeeping(fd
    ? encodeCanFdFrame(c.targetSysId, c.targetCompId, bus, can, c.sysId, c.compId)
    : encodeCanFrame(c.targetSysId, c.targetCompId, bus, can, c.sysId, c.compId))
}

/**
 * Enable MAVLink CAN passthrough on the given bus (1 or 2; 0 disables). The
 * ACK is awaited so the caller knows the FC accepted before opening a CAN client.
 */
export function enableCanForward(c: ExtCommandContext, bus: number): Promise<CommandResult> {
  return c.sendCommandLong(MAV_CMD_CAN_FORWARD, [bus, 0, 0, 0, 0, 0, 0])
}

/**
 * Test a single actuator output (PX4). `functionCode` is an
 * ACTUATOR_OUTPUT_FUNCTION (Motor1=1..16, Servo1=33..48), `value` is
 * normalized (-1..1; NaN = stop), `timeoutS` auto-restores the output. The
 * FC rejects the command while armed.
 */
export function actuatorTest(c: ExtCommandContext, functionCode: number, value: number, timeoutS: number): Promise<CommandResult> {
  // MAV_CMD_ACTUATOR_TEST (310): p1 value, p2 timeout, p5 output function.
  return c.sendCommandLong(310, [value, timeoutS, 0, 0, functionCode, 0, 0])
}
