/**
 * iNav timer outputs: the usage flags follow drivers/timer.h, and a mode
 * override is one 2-byte MSP2_INAV_SET_TIMER_OUTPUT_MODE frame per timer (the
 * firmware refuses any other size).
 */

import { describe, expect, it } from 'vitest'
import { timerUsageLabel, TIMER_OUTPUT_MODE_OPTIONS } from '@/components/fc/inav/inav-output-mapping'
import { MSPAdapter } from '@/lib/protocol/msp-adapter'
import { INAV_MSP } from '@/lib/protocol/msp/msp-decoders-inav'

describe('iNav timer usage flags', () => {
  it('names the timerUsageFlag_e bits', () => {
    expect(timerUsageLabel(1 << 2)).toBe('MOTOR')
    expect(timerUsageLabel((1 << 2) | (1 << 3))).toBe('MOTOR+SERVO')
    expect(timerUsageLabel(1 << 24)).toBe('LED')
    expect(timerUsageLabel(1 << 1)).toBe('PWM')
    expect(timerUsageLabel(0)).toBe('NONE')
    expect(timerUsageLabel((1 << 2) | (1 << 30))).toBe('MOTOR+0x40000000')
  })

  it('offers the outputMode_e overrides', () => {
    expect(TIMER_OUTPUT_MODE_OPTIONS.map((o) => [o.value, o.label])).toEqual([
      ['0', 'Auto'], ['1', 'Motors'], ['2', 'Servos'], ['3', 'LED'], ['4', 'PINIO'], ['5', 'Beeper'],
    ])
  })

  it('sends one 2-byte frame per timer', async () => {
    const adapter = new MSPAdapter()
    const frames: number[][] = []
    ;(adapter as unknown as { queue: unknown }).queue = {
      send: async (cmd: number, payload?: Uint8Array) => {
        if (cmd === INAV_MSP.MSP2_INAV_SET_TIMER_OUTPUT_MODE) frames.push(Array.from(payload ?? []))
        return { command: cmd, payload: new Uint8Array(0) }
      },
    }
    const result = await adapter.setTimerOutputMode([{ timerId: 0, mode: 1 }, { timerId: 3, mode: 2 }])
    expect(result.success).toBe(true)
    expect(frames).toEqual([[0, 1], [3, 2]])
  })
})
