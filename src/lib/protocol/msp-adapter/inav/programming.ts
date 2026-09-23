/**
 * iNav programming adapter functions: logic conditions, global variables,
 * programmable PIDs, plus live status readouts.
 *
 * @module protocol/msp-adapter/inav/programming
 */

import type { CommandResult } from '../../types'
import type { MspSerialQueue } from '../../msp/msp-serial-queue'
import { formatErrorMessage } from '@/lib/utils'
import {
  INAV_MSP,
  decodeMspINavLogicConditions,
  decodeMspINavLogicConditionsStatus,
  decodeMspINavGvarStatus,
  decodeMspINavProgrammingPid,
  decodeMspINavProgrammingPidStatus,
  type INavLogicCondition,
  type INavLogicConditionsStatus,
  type INavGvarStatus,
  type INavProgrammingPid,
  type INavProgrammingPidStatus,
} from '../../msp/msp-decoders-inav'
import {
  encodeMspINavSetLogicCondition,
  encodeMspINavSetProgrammingPid,
  encodeMspINavSetGvar,
} from '../../msp/msp-encoders-inav'
import { NOT_CONNECTED, dv } from './helpers'

/** iNav MAX_LOGIC_CONDITIONS — read each slot individually. */
const LOGIC_CONDITION_COUNT = 64

const EMPTY_LOGIC_CONDITION: INavLogicCondition = {
  enabled: false,
  activatorId: 0,
  operation: 0,
  operandAType: 0,
  operandAValue: 0,
  operandBType: 0,
  operandBValue: 0,
  flags: 0,
}

export async function inavDownloadLogicConditions(queue: MspSerialQueue | null): Promise<INavLogicCondition[]> {
  if (!queue) return []
  // iNav has no working bulk logic-conditions getter (0x2022 returns nothing),
  // so read each condition one at a time via MSP2_INAV_LOGIC_CONDITIONS_SINGLE.
  const result: INavLogicCondition[] = []
  for (let i = 0; i < LOGIC_CONDITION_COUNT; i++) {
    let frame
    try {
      frame = await queue.send(INAV_MSP.MSP2_INAV_LOGIC_CONDITIONS_SINGLE, Uint8Array.of(i))
    } catch {
      // firmware with fewer slots (or a transient timeout): stop reading here
      break
    }
    const decoded = decodeMspINavLogicConditions(dv(frame.payload))
    result.push(decoded[0] ?? { ...EMPTY_LOGIC_CONDITION })
  }
  return result
}

export async function inavUploadLogicCondition(
  queue: MspSerialQueue | null,
  idx: number,
  rule: INavLogicCondition,
): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    const idxBuf = new Uint8Array(1)
    idxBuf[0] = idx
    const payload = new Uint8Array(1 + 14)
    payload.set(idxBuf, 0)
    payload.set(encodeMspINavSetLogicCondition(rule), 1)
    await queue.send(INAV_MSP.MSP2_INAV_SET_LOGIC_CONDITIONS, payload)
    return { success: true, resultCode: 0, message: 'Logic condition saved' }
  } catch (err) {
    return { success: false, resultCode: -1, message: formatErrorMessage(err) }
  }
}

export async function inavDownloadLogicConditionsStatus(queue: MspSerialQueue | null): Promise<INavLogicConditionsStatus[]> {
  if (!queue) return []
  const frame = await queue.send(INAV_MSP.MSP2_INAV_LOGIC_CONDITIONS_STATUS)
  return decodeMspINavLogicConditionsStatus(dv(frame.payload))
}

export async function inavDownloadGvarStatus(queue: MspSerialQueue | null): Promise<INavGvarStatus> {
  if (!queue) return { values: [] }
  const frame = await queue.send(INAV_MSP.MSP2_INAV_GVAR_STATUS)
  return decodeMspINavGvarStatus(dv(frame.payload))
}

export async function inavSetGvar(
  queue: MspSerialQueue | null,
  index: number,
  value: number,
): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    await queue.send(INAV_MSP.MSP2_INAV_SET_GVAR, encodeMspINavSetGvar(index, value))
    return { success: true, resultCode: 0, message: 'Global variable set' }
  } catch (err) {
    return { success: false, resultCode: -1, message: formatErrorMessage(err) }
  }
}

export async function inavDownloadProgrammingPids(queue: MspSerialQueue | null): Promise<INavProgrammingPid[]> {
  if (!queue) return []
  const frame = await queue.send(INAV_MSP.MSP2_INAV_PROGRAMMING_PID)
  return decodeMspINavProgrammingPid(dv(frame.payload))
}

export async function inavUploadProgrammingPid(
  queue: MspSerialQueue | null,
  idx: number,
  rule: INavProgrammingPid,
): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    await queue.send(INAV_MSP.MSP2_INAV_SET_PROGRAMMING_PID, encodeMspINavSetProgrammingPid(idx, rule))
    return { success: true, resultCode: 0, message: 'Programming PID saved' }
  } catch (err) {
    return { success: false, resultCode: -1, message: formatErrorMessage(err) }
  }
}

export async function inavDownloadProgrammingPidStatus(queue: MspSerialQueue | null): Promise<INavProgrammingPidStatus[]> {
  if (!queue) return []
  const frame = await queue.send(INAV_MSP.MSP2_INAV_PROGRAMMING_PID_STATUS)
  return decodeMspINavProgrammingPidStatus(dv(frame.payload))
}

// ── Motor mixer download / upload ─────────────────────────────

