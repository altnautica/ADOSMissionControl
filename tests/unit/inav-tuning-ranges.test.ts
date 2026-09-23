/**
 * iNav stores several tuning values without checking them (EZ Tune applies its
 * block at once; SET_SETTING only checks the upper bound of unsigned values),
 * so the GCS is the only thing between an operator and a sub-minimum value.
 * These pin the firmware ranges and the refusal behaviour.
 */

import { describe, expect, it, vi } from 'vitest'
import { EZ_TUNE_DEFAULTS, EZ_TUNE_FIELDS, ezTuneRangeError } from '@/components/fc/inav/ez-tune-fields'
import { readSettingGroup, writeSettingGroup, type SettingSpec } from '@/components/fc/inav/inav-setting-fields'
import { INavMockProtocol } from '@/mock/inav-mock-protocol'
import type { SettingsCapability } from '@/lib/protocol/types'

describe('EZ Tune ranges', () => {
  it('uses the firmware ranges, and the defaults sit inside them', () => {
    const range = Object.fromEntries(EZ_TUNE_FIELDS.map((f) => [f.key, [f.min, f.max]]))
    expect(range.filterHz).toEqual([20, 300])
    expect(range.axisRatio).toEqual([25, 175])
    for (const k of ['response', 'damping', 'stability', 'aggressiveness', 'rate', 'expo']) {
      expect(range[k]).toEqual([0, 200])
    }
    expect(range.snappiness).toEqual([0, 100])
    expect(ezTuneRangeError(EZ_TUNE_DEFAULTS)).toBeNull()
  })

  it('refuses an axis ratio of 0, which would zero the pitch gains', () => {
    expect(ezTuneRangeError({ ...EZ_TUNE_DEFAULTS, axisRatio: 0 })).toMatch(/Axis ratio must be 25 to 175/)
    expect(ezTuneRangeError({ ...EZ_TUNE_DEFAULTS, filterHz: 10 })).toMatch(/Filter cutoff/)
  })
})

const RATE_DYNAMICS: SettingSpec<string>[] = [
  { key: 'cs', name: 'rate_dynamics_center_sensitivity' },
  { key: 'cc', name: 'rate_dynamics_center_correction' },
  { key: 'cw', name: 'rate_dynamics_center_weight' },
]

describe('iNav named-setting groups', () => {
  it('reads each setting with the range the FC reports', async () => {
    const fc = new INavMockProtocol({ vehicleClass: 'copter' })
    const group = await readSettingGroup(fc.settings, RATE_DYNAMICS)
    expect(group.values).toEqual({ cs: 100, cc: 10, cw: 0 })
    expect(group.ranges).toEqual({ cs: { min: 25, max: 175 }, cc: { min: 10, max: 95 }, cw: { min: 0, max: 95 } })
  })

  it('writes nothing when any value is below its minimum', async () => {
    const fc = new INavMockProtocol({ vehicleClass: 'copter' })
    const group = await readSettingGroup(fc.settings, RATE_DYNAMICS)
    const setSetting = vi.spyOn(fc.settings, 'setSetting')
    group.values.cc = 5
    await expect(writeSettingGroup(fc.settings, RATE_DYNAMICS, group)).rejects.toThrow(
      'rate_dynamics_center_correction must be 10 to 95',
    )
    expect(setSetting).not.toHaveBeenCalled()
  })

  it('fails on the first setting the FC refuses', async () => {
    const settings: SettingsCapability = {
      getSetting: async () => ({ type: 'uint8', value: 50 }),
      getSettingInfo: async (name) => ({ name, pgId: 0, type: 0, section: 0, mode: 0, min: 0, max: 255, index: 0, profileCurrent: 0, profileCount: 1 }),
      setSetting: async (name) => name === 'rate_dynamics_center_correction'
        ? { success: false, resultCode: 1, message: 'refused' }
        : { success: true, resultCode: 0, message: 'OK' },
      enumerate: async () => [],
    }
    const group = await readSettingGroup(settings, RATE_DYNAMICS)
    await expect(writeSettingGroup(settings, RATE_DYNAMICS, group)).rejects.toThrow('rate_dynamics_center_correction: refused')
  })
})
