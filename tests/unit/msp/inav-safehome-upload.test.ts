/**
 * iNav holds MAX_SAFE_HOMES = 8 safehomes and answers MSP_RESULT_ERROR for a
 * slot at or beyond it. An upload writes every slot, and a failure part way
 * says exactly which slots reached the FC.
 */

import { describe, expect, it, vi } from 'vitest'
import { inavUploadSafehomes } from '@/lib/protocol/msp-adapter/inav/mission'
import { INAV_MSP } from '@/lib/protocol/msp/msp-decoders-inav'
import type { MspSerialQueue } from '@/lib/protocol/msp/msp-serial-queue'
import { useSafehomeStore } from '@/stores/safehome-store'
import type { DroneProtocol } from '@/lib/protocol/types'

function fc(failAtSlot?: number) {
  const slots: number[] = []
  const queue = {
    send: async (cmd: number, payload?: Uint8Array) => {
      if (cmd === INAV_MSP.MSP2_INAV_SET_SAFEHOME) {
        const slot = payload?.[0] ?? -1
        if (slot === failAtSlot || slot >= 8) throw new Error('MSP error reply')
        slots.push(slot)
      }
      return { command: cmd, payload: new Uint8Array(0) }
    },
  } as unknown as MspSerialQueue
  return { queue, slots }
}

describe('iNav safehome upload', () => {
  it('writes all 8 slots, clearing the ones with no safehome', async () => {
    const { queue, slots } = fc()
    const result = await inavUploadSafehomes(queue, [{ index: 0, enabled: true, lat: 12.97, lon: 77.59 }])
    expect(result.success).toBe(true)
    expect(slots).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('says which slots were written when one is refused', async () => {
    const { queue } = fc(3)
    const result = await inavUploadSafehomes(queue, [])
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/slot 3 failed .*slots 0-2 were written/)
  })

  it('marks a read with no safehomes as loaded', async () => {
    const empty = Array.from({ length: 8 }, (_, index) => ({ index, enabled: false, lat: 0, lon: 0 }))
    const protocol = { downloadSafehomes: vi.fn().mockResolvedValue(empty) } as unknown as DroneProtocol
    await useSafehomeStore.getState().loadFromFc(protocol)
    expect(useSafehomeStore.getState().loaded).toBe(true)
  })
})
