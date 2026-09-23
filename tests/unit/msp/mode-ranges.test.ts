/**
 * Mode ranges carry Betaflight's permanent box ids (GPS RESCUE is 46, not its
 * position in a name list), so the modes a panel offers come from the FC's own
 * MSP_BOXNAMES + MSP_BOXIDS, and a save rewrites every slot the FC has.
 */

import { describe, expect, it } from 'vitest'
import { mspGetModeBoxes, mspSetModeRanges } from '@/lib/protocol/msp-adapter/ranges'
import { MSP } from '@/lib/protocol/msp/msp-constants'
import type { MspSerialQueue } from '@/lib/protocol/msp/msp-serial-queue'

type Sent = { cmd: number; payload: number[] }

function fakeFc(replies: Record<number, Uint8Array>, failOn?: (s: Sent) => boolean) {
  const sent: Sent[] = []
  const queue = {
    send: async (cmd: number, payload?: Uint8Array) => {
      const s = { cmd, payload: Array.from(payload ?? []) }
      sent.push(s)
      if (failOn?.(s)) throw new Error('no ack')
      return { command: cmd, payload: replies[cmd] ?? new Uint8Array(0) }
    },
  } as unknown as MspSerialQueue
  return { queue, sent }
}

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

describe('Betaflight mode boxes and ranges', () => {
  it('names each mode by its permanent id', async () => {
    const { queue } = fakeFc({
      [MSP.MSP_BOXNAMES]: ascii('ARM;ANGLE;GPS RESCUE;'),
      [MSP.MSP_BOXIDS]: new Uint8Array([0, 1, 46]),
    })
    expect(await mspGetModeBoxes(queue)).toEqual([
      { id: 0, name: 'ARM' },
      { id: 1, name: 'ANGLE' },
      { id: 46, name: 'GPS RESCUE' },
    ])
  })

  it('refuses a name list that does not line up with the id list', async () => {
    const { queue } = fakeFc({
      [MSP.MSP_BOXNAMES]: ascii('ARM;ANGLE;'),
      [MSP.MSP_BOXIDS]: new Uint8Array([0]),
    })
    await expect(mspGetModeBoxes(queue)).rejects.toThrow(/2 mode names but 1 mode ids/)
  })

  it('writes every slot the FC has, with permanent ids, and clears the rest', async () => {
    const { queue, sent } = fakeFc({ [MSP.MSP_MODE_RANGES]: new Uint8Array(3 * 4) })
    const result = await mspSetModeRanges(
      queue,
      [{ boxId: 46, auxChannel: 2, rangeStart: 1700, rangeEnd: 2100, modeLogic: 1, linkedTo: 0 }],
      true,
    )
    expect(result.success).toBe(true)
    const writes = sent.filter((s) => s.cmd === MSP.MSP_SET_MODE_RANGE).map((s) => s.payload)
    expect(writes).toEqual([
      [0, 46, 2, 32, 48, 1, 0],
      [1, 0, 0, 0, 0, 0, 0],
      [2, 0, 0, 0, 0, 0, 0],
    ])
  })

  it('reports the slot a failed write stopped at', async () => {
    const { queue } = fakeFc(
      { [MSP.MSP_MODE_RANGES]: new Uint8Array(2 * 4) },
      (s) => s.cmd === MSP.MSP_SET_MODE_RANGE && s.payload[0] === 1,
    )
    const result = await mspSetModeRanges(queue, [], false)
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/slot 1 was not written/)
  })
})
