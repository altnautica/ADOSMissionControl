/**
 * VTX type labels follow Betaflight's vtxDevType_e, and power levels are read
 * from the FC's VTX table (MSP_VTXTABLE_POWERLEVEL, 1-based) rather than a
 * fixed mW list.
 */

import { describe, it, expect } from 'vitest'
import { bfGetVtxPowerLevels } from '@/lib/protocol/msp-adapter/bf-config'
import { MSP } from '@/lib/protocol/msp/msp-constants'
import type { MspSerialQueue } from '@/lib/protocol/msp/msp-serial-queue'
import { VTX_TYPE_LABELS } from '@/components/fc/misc/vtx-constants'

/** MSP_VTX_CONFIG reply: type, band, channel, power, pit, freq, ready, lowPower, pitFreq, table flag + sizes. */
function vtxConfig(tableAvailable: boolean, powerLevels: number): Uint8Array {
  const p = new Uint8Array(15)
  const dv = new DataView(p.buffer)
  p[0] = 3 // SmartAudio
  p[3] = 2 // power index
  dv.setUint16(5, 5740, true)
  p[11] = tableAvailable ? 1 : 0
  p[12] = 5
  p[13] = 8
  p[14] = powerLevels
  return p
}

function powerLevel(level: number, value: number, label: string): Uint8Array {
  const p = new Uint8Array(4 + label.length)
  const dv = new DataView(p.buffer)
  p[0] = level
  dv.setUint16(1, value, true)
  p[3] = label.length
  for (let i = 0; i < label.length; i++) p[4 + i] = label.charCodeAt(i)
  return p
}

function fakeQueue(tableAvailable: boolean, labels: string[]) {
  const requests: Array<[number, number[]]> = []
  const queue = {
    send: async (command: number, payload?: Uint8Array) => {
      requests.push([command, payload ? [...payload] : []])
      if (command === MSP.MSP_VTX_CONFIG) return { command, payload: vtxConfig(tableAvailable, labels.length) }
      const level = payload?.[0] ?? 0
      return { command, payload: powerLevel(level, level * 10, labels[level - 1]) }
    },
  } as Partial<MspSerialQueue> as MspSerialQueue
  return { queue, requests }
}

describe('Betaflight VTX', () => {
  it('labels the device type by vtxDevType_e', () => {
    expect(VTX_TYPE_LABELS[1]).toBe('RTC6705')
    expect(VTX_TYPE_LABELS[2]).toBeUndefined()
    expect(VTX_TYPE_LABELS[3]).toBe('SmartAudio')
    expect(VTX_TYPE_LABELS[4]).toBe('Tramp')
    expect(VTX_TYPE_LABELS[5]).toBe('MSP')
    expect(VTX_TYPE_LABELS[255]).toBe('No device detected')
  })

  it('reads each 1-based power level of the VTX table', async () => {
    const { queue, requests } = fakeQueue(true, ['25 ', '200', '500', '800'])
    const levels = await bfGetVtxPowerLevels(queue)
    expect(levels.map((l) => [l.powerNumber, l.powerLabel])).toEqual([
      [1, '25 '], [2, '200'], [3, '500'], [4, '800'],
    ])
    expect(requests.filter(([c]) => c === MSP.MSP_VTXTABLE_POWERLEVEL).map(([, p]) => p)).toEqual([[1], [2], [3], [4]])
  })

  it('reports no levels when the FC has no VTX table', async () => {
    const { queue } = fakeQueue(false, ['25 '])
    expect(await bfGetVtxPowerLevels(queue)).toEqual([])
  })
})
