/**
 * iNav fixed-wing approach adapter functions: read + write.
 *
 * @module protocol/msp-adapter/inav/fw-approach
 */

import type { CommandResult } from '../../types'
import type { MspSerialQueue } from '../../msp/msp-serial-queue'
import { formatErrorMessage } from '@/lib/utils'
import {
  INAV_MSP,
  decodeMspINavFwApproach,
  type INavFwApproach,
} from '../../msp/msp-decoders-inav'
import { encodeMspINavSetFwApproach } from '../../msp/msp-encoders-inav'
import { NOT_CONNECTED, dv } from './helpers'

/** Read one FW approach slot; the FC answers only for the index it is sent. */
export async function inavGetFwApproach(queue: MspSerialQueue | null, index: number): Promise<INavFwApproach> {
  if (!queue) throw new Error('Not connected')
  const frame = await queue.send(INAV_MSP.MSP2_INAV_FW_APPROACH, new Uint8Array([index & 0xff]))
  return decodeMspINavFwApproach(dv(frame.payload))
}

export async function inavSetFwApproach(queue: MspSerialQueue | null, a: INavFwApproach): Promise<CommandResult> {
  if (!queue) return NOT_CONNECTED
  try {
    await queue.send(INAV_MSP.MSP2_INAV_SET_FW_APPROACH, encodeMspINavSetFwApproach(a))
    return { success: true, resultCode: 0, message: 'FW approach saved' }
  } catch (err) {
    return { success: false, resultCode: -1, message: formatErrorMessage(err) }
  }
}

// ── OSD layouts / alarms / preferences ───────────────────────

