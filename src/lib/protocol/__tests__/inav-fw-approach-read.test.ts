/**
 * @license GPL-3.0-only
 *
 * MSP2_INAV_FW_APPROACH answers one slot per request, indexed by the request's
 * first payload byte. A request without it makes the FC index with whatever the
 * buffer held, so at most one arbitrary slot comes back.
 */

import { describe, it, expect } from 'vitest'

import { MSPAdapter } from '../msp-adapter'
import { INAV_MSP, INAV_LIMITS } from '../msp/msp-decoders-inav'

describe('iNav FW approach read', () => {
  it('asks for every slot by index and returns them in order', async () => {
    const adapter = new MSPAdapter()
    const requested: number[][] = []
    const queue = {
      send: async (cmd: number, payload?: Uint8Array) => {
        const index = payload?.[0] ?? 0xff
        requested.push(cmd === INAV_MSP.MSP2_INAV_FW_APPROACH ? Array.from(payload ?? []) : [])
        const reply = new Uint8Array(15)
        reply[0] = index
        reply[9] = index % 2
        return { command: cmd, payload: reply }
      },
    }
    ;(adapter as unknown as { queue: unknown }).queue = queue

    const slots = await adapter.getFwApproach()
    expect(slots.map((s) => s.number)).toEqual(Array.from({ length: INAV_LIMITS.FW_APPROACHES }, (_, i) => i))
    expect(requested).toEqual(Array.from({ length: INAV_LIMITS.FW_APPROACHES }, (_, i) => [i]))
    expect(slots[1].approachDirection).toBe(1)
  })
})
