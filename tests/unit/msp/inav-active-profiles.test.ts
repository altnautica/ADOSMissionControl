/**
 * iNav reports the profiles it is flying in MSP2_INAV_STATUS byte 8: battery
 * profile in the high nibble, control profile in the low one. The profile
 * panels show these, so a swapped nibble shows the wrong profile as active.
 */

import { describe, expect, it } from 'vitest'
import { inavGetActiveProfiles, inavSelectControlProfile } from '@/lib/protocol/msp-adapter-inav'
import { INAV_MSP } from '@/lib/protocol/msp/msp-decoders-inav'
import { MSP } from '@/lib/protocol/msp/msp-constants'
import type { MspSerialQueue } from '@/lib/protocol/msp/msp-serial-queue'

function statusQueue(profiles: number, fail = false, reply = new Uint8Array(13)) {
  const sent: Array<{ cmd: number; payload: number[] }> = []
  const queue = {
    send: async (cmd: number, payload?: Uint8Array) => {
      sent.push({ cmd, payload: Array.from(payload ?? []) })
      if (fail) throw new Error('MSP error reply')
      if (cmd === INAV_MSP.MSP2_INAV_STATUS) reply[8] = profiles
      return { command: cmd, payload: reply }
    },
  } as unknown as MspSerialQueue
  return { queue, sent }
}

describe('iNav active profiles', () => {
  it('reads the battery profile from the high nibble and the control profile from the low', async () => {
    const { queue } = statusQueue(0x21)
    expect(await inavGetActiveProfiles(queue)).toEqual({ controlProfile: 1, batteryProfile: 2, mixerProfile: null })
  })

  it('reads the mixer profile from the byte after the box-mode bitmask', async () => {
    // 13 fixed bytes, two u32 words of box-mode flags, then the mixer profile.
    const reply = new Uint8Array(22)
    reply.fill(0xff, 13, 21)
    reply[21] = 1
    const { queue } = statusQueue(0, false, reply)
    expect((await inavGetActiveProfiles(queue)).mixerProfile).toBe(1)
  })

  it('reports no mixer profile when the firmware sends only the box-mode bitmask', async () => {
    const reply = new Uint8Array(21)
    reply[20] = 1
    const { queue } = statusQueue(0, false, reply)
    expect((await inavGetActiveProfiles(queue)).mixerProfile).toBeNull()
  })

  it('switches the control profile with MSP_SELECT_SETTING', async () => {
    const { queue, sent } = statusQueue(0)
    const result = await inavSelectControlProfile(queue, 2)
    expect(result.success).toBe(true)
    expect(sent).toEqual([{ cmd: MSP.MSP_SELECT_SETTING, payload: [2] }])
  })

  it('reports a refused switch as a failure', async () => {
    const { queue } = statusQueue(0, true)
    expect((await inavSelectControlProfile(queue, 1)).success).toBe(false)
  })
})
