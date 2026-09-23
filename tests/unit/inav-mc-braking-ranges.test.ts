/**
 * MSP2_INAV_SET_MC_BRAKING sends boost factor and bank angle as u8 and the
 * other fields as u16. A value outside the nav_mc_braking_* range must be
 * brought into range before the write, never sent to wrap on the wire.
 */

import { describe, expect, it } from 'vitest'
import { clampMcBraking } from '@/components/fc/inav/mc-braking-ranges'
import type { INavMcBraking } from '@/lib/protocol/msp/msp-decoders-inav'

const IN_RANGE: INavMcBraking = {
  speedThreshold: 150, disengageSpeed: 75, timeout: 2000, boostFactor: 100,
  boostTimeout: 750, boostSpeedThreshold: 150, boostDisengage: 75, bankAngle: 40,
}

describe('MC braking ranges', () => {
  it('leaves values inside the firmware ranges unchanged', () => {
    expect(clampMcBraking(IN_RANGE)).toEqual({ value: IN_RANGE, adjusted: [] })
  })

  it('brings a bank angle above 60 and a negative speed into range', () => {
    const { value, adjusted } = clampMcBraking({ ...IN_RANGE, bankAngle: 300, disengageSpeed: -5 })
    expect(value.bankAngle).toBe(60)
    expect(value.disengageSpeed).toBe(0)
    expect(adjusted.sort()).toEqual(['bankAngle', 'disengageSpeed'])
  })
})
