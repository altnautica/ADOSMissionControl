/**
 * @license GPL-3.0-only
 *
 * An MSP config write only changes the flight controller's RAM. Unless the
 * adapter follows it with MSP_EEPROM_WRITE, every change the panel reports as
 * written is gone at the next power cycle. A save that fails must not read as
 * success either.
 */

import { describe, it, expect } from 'vitest'

import { MSPAdapter } from '../msp-adapter'
import { MSP } from '../msp/msp-constants'

/** Give the adapter a recording queue in place of a connected link. */
function withQueue(failOn?: number): { adapter: MSPAdapter; sent: number[] } {
  const adapter = new MSPAdapter()
  const sent: number[] = []
  const queue = {
    send: async (cmd: number) => {
      sent.push(cmd)
      if (cmd === failOn) throw new Error('timeout')
      return { command: cmd, payload: new Uint8Array(0) }
    },
  }
  ;(adapter as unknown as { queue: unknown }).queue = queue
  return { adapter, sent }
}

describe('MSP config writes are saved to EEPROM', () => {
  it('follows a config write with MSP_EEPROM_WRITE', async () => {
    const { adapter, sent } = withQueue()
    const result = await adapter.setLedColors([{ h: 120, s: 255, v: 255 }])
    expect(result.success).toBe(true)
    expect(sent).toEqual([MSP.MSP_SET_LED_COLORS, MSP.MSP_EEPROM_WRITE])
  })

  it('reports a write whose save failed as a failure', async () => {
    const { adapter } = withQueue(MSP.MSP_EEPROM_WRITE)
    const result = await adapter.setLedColors([{ h: 120, s: 255, v: 255 }])
    expect(result.success).toBe(false)
    expect(result.message).toMatch(/not saved/)
  })

  it('does not save after a refused write', async () => {
    const { adapter, sent } = withQueue(MSP.MSP_SET_LED_COLORS)
    await expect(adapter.setLedColors([{ h: 120, s: 255, v: 255 }])).rejects.toThrow('timeout')
    expect(sent).not.toContain(MSP.MSP_EEPROM_WRITE)
  })
})
