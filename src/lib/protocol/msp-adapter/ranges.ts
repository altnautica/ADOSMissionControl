/**
 * Mode ranges (AUX switch → flight mode) and adjustment ranges (AUX switch →
 * in-flight tuning) over MSP, for Betaflight and iNav.
 *
 * Reads return every slot the FC has, in slot order, empty ones included
 * (an empty slot has rangeStart >= rangeEnd). Writes take the ranges to keep,
 * put them in slots 0..n-1 and clear every remaining slot, so a range removed
 * in the editor cannot stay active on the FC.
 *
 * @module protocol/msp-adapter/ranges
 */

import type { CommandResult } from '../types'
import type { MspSerialQueue } from '../msp/msp-serial-queue'
import { MSP } from '../msp/msp-constants'
import {
  decodeMspAdjustmentRanges,
  decodeMspBoxIds,
  decodeMspBoxNames,
  decodeMspModeRanges,
  type MspAdjustmentRange,
  type MspModeBox,
  type MspModeRange,
} from '../msp/msp-decoders-status'
import { encodeMspSetModeRange } from '../msp/encoders/config'
import { encodeMspSetAdjustmentRange } from '../msp/encoders/tuning'
import { formatErrorMessage } from '@/lib/utils'

function view(p: Uint8Array): DataView {
  return new DataView(p.buffer, p.byteOffset, p.byteLength)
}

function requireQueue(queue: MspSerialQueue | null): MspSerialQueue {
  if (!queue) throw new Error('Not connected to flight controller')
  return queue
}

const EMPTY_MODE_RANGE: MspModeRange = { boxId: 0, auxChannel: 0, rangeStart: 900, rangeEnd: 900 }
const EMPTY_ADJUSTMENT_RANGE: MspAdjustmentRange = {
  slotIndex: 0, auxChannelIndex: 0, rangeStart: 900, rangeEnd: 900, adjustmentFunction: 0, auxSwitchChannelIndex: 0,
}

/** The modes this FC offers, by permanent box id. */
export async function mspGetModeBoxes(queue: MspSerialQueue | null): Promise<MspModeBox[]> {
  const q = requireQueue(queue)
  const names = decodeMspBoxNames(view((await q.send(MSP.MSP_BOXNAMES)).payload)).names
  const ids = decodeMspBoxIds(view((await q.send(MSP.MSP_BOXIDS)).payload)).ids
  if (names.length !== ids.length) {
    throw new Error(`Flight controller reported ${names.length} mode names but ${ids.length} mode ids`)
  }
  return names.map((name, i) => ({ id: ids[i], name }))
}

/**
 * Read every mode-range slot. With `linked` (Betaflight), each slot also
 * carries its AND/OR logic and linked mode from MSP_MODE_RANGES_EXTRA.
 */
export async function mspGetModeRanges(queue: MspSerialQueue | null, linked: boolean): Promise<MspModeRange[]> {
  const q = requireQueue(queue)
  const ranges = decodeMspModeRanges(view((await q.send(MSP.MSP_MODE_RANGES)).payload))
  if (!linked) return ranges
  // U8 count, then per slot: U8 permanent id, U8 modeLogic, U8 linkedTo.
  const extra = (await q.send(MSP.MSP_MODE_RANGES_EXTRA)).payload
  const count = Math.min(extra[0] ?? 0, ranges.length)
  for (let i = 0; i < count; i++) {
    const off = 1 + i * 3
    if (off + 2 >= extra.length) break
    ranges[i] = { ...ranges[i], modeLogic: extra[off + 1], linkedTo: extra[off + 2] }
  }
  return ranges
}

async function writeSlots<T>(
  slotCount: number,
  items: readonly T[],
  empty: T,
  what: string,
  send: (index: number, item: T) => Promise<unknown>,
): Promise<CommandResult> {
  if (items.length > slotCount) {
    return { success: false, resultCode: -1, message: `This flight controller has ${slotCount} ${what} slots; ${items.length} do not fit` }
  }
  for (let i = 0; i < slotCount; i++) {
    try {
      await send(i, items[i] ?? empty)
    } catch (err) {
      return { success: false, resultCode: -1, message: `${what} slot ${i} was not written: ${formatErrorMessage(err)}` }
    }
  }
  return { success: true, resultCode: 0, message: `${items.length} ${what}s written` }
}

/**
 * Write `ranges` to slots 0..n-1 and clear the rest. With `linked`
 * (Betaflight) every slot also carries modeLogic/linkedTo, so a cleared slot
 * cannot keep following another mode.
 */
export async function mspSetModeRanges(
  queue: MspSerialQueue | null,
  ranges: readonly MspModeRange[],
  linked: boolean,
): Promise<CommandResult> {
  const q = requireQueue(queue)
  const slotCount = Math.floor((await q.send(MSP.MSP_MODE_RANGES)).payload.length / 4)
  return writeSlots(slotCount, ranges, EMPTY_MODE_RANGE, 'mode range', (index, r) =>
    q.send(MSP.MSP_SET_MODE_RANGE, encodeMspSetModeRange(
      { index, ...r },
      linked ? { modeLogic: r.modeLogic ?? 0, linkedTo: r.linkedTo ?? 0 } : undefined,
    )),
  )
}

/** Read every adjustment-range slot. */
export async function mspGetAdjustmentRanges(queue: MspSerialQueue | null): Promise<MspAdjustmentRange[]> {
  const q = requireQueue(queue)
  return decodeMspAdjustmentRanges(view((await q.send(MSP.MSP_ADJUSTMENT_RANGES)).payload))
}

/** Write `ranges` to slots 0..n-1 and clear the rest. */
export async function mspSetAdjustmentRanges(
  queue: MspSerialQueue | null,
  ranges: readonly MspAdjustmentRange[],
): Promise<CommandResult> {
  const q = requireQueue(queue)
  const slotCount = Math.floor((await q.send(MSP.MSP_ADJUSTMENT_RANGES)).payload.length / 6)
  return writeSlots(slotCount, ranges, EMPTY_ADJUSTMENT_RANGE, 'adjustment range', (index, r) =>
    q.send(MSP.MSP_SET_ADJUSTMENT_RANGE, encodeMspSetAdjustmentRange(index, r)),
  )
}
