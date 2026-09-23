/**
 * MSP2_INAV_TEMP_SENSOR_CONFIG carries one 18-byte record per sensor (type,
 * address, alarm range, OSD symbol, label). A failed read must reach the panel
 * as an error, not as an empty list that reads as "no sensors configured".
 */

import { describe, expect, it } from 'vitest'
import { inavGetTempSensorConfigs } from '@/lib/protocol/msp-adapter-inav'
import type { MspSerialQueue } from '@/lib/protocol/msp/msp-serial-queue'

function record(type: number, addr0: number, osdSymbol: number, label: string): number[] {
  const out = [type, addr0, 0, 0, 0, 0, 0, 0, 0]
  out.push(0x9c, 0xff) // alarm_min -100
  out.push(0x84, 0x03) // alarm_max 900
  out.push(osdSymbol)
  for (let i = 0; i < 4; i++) out.push(label.charCodeAt(i) || 0)
  return out
}

function queueReplying(payload: Uint8Array | Error) {
  return {
    send: async (cmd: number) => {
      if (payload instanceof Error) throw payload
      return { command: cmd, payload }
    },
  } as unknown as MspSerialQueue
}

describe('iNav temperature sensor config', () => {
  it('decodes every sensor from 18-byte records', async () => {
    const payload = new Uint8Array([...record(2, 0x28, 1, 'ESC'), ...record(1, 0x48, 2, 'VREG')])
    const sensors = await inavGetTempSensorConfigs(queueReplying(payload))
    expect(sensors).toHaveLength(2)
    expect(sensors[1]).toEqual({
      type: 1,
      address: [0x48, 0, 0, 0, 0, 0, 0, 0],
      alarmMin: -100,
      alarmMax: 900,
      osdSymbol: 2,
      label: 'VREG',
    })
  })

  it('rejects when the read fails instead of reporting no sensors', async () => {
    await expect(inavGetTempSensorConfigs(queueReplying(new Error('MSP timeout')))).rejects.toThrow('MSP timeout')
  })
})
