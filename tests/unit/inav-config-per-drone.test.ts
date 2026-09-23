/**
 * The iNav config tables belong to one flight controller. Selecting another
 * drone must never show drone A's mixer as drone B's, or let a Write push A's
 * table into B, and a read still in flight when the selection changes must
 * land in the drone it was started for.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { useMixerStore } from '@/stores/mixer-store'
import type { DroneProtocol } from '@/lib/protocol/types'
import type { MotorMixerRule } from '@/lib/protocol/msp/msp-decoders-inav'

const RULE: MotorMixerRule = { throttle: 1, roll: -1, pitch: 1, yaw: -1 }

function deferredProtocol() {
  let resolve: (rules: MotorMixerRule[]) => void = () => {}
  const motors = new Promise<MotorMixerRule[]>((r) => { resolve = r })
  const protocol = {
    downloadMotorMixer: () => motors,
    downloadServoMixer: async () => [],
    getMixerConfig: async () => ({ maxSupportedMotors: 12, maxSupportedServos: 18 }),
  } as unknown as DroneProtocol
  return { protocol, resolve }
}

describe('iNav mixer tables are held per drone', () => {
  beforeEach(() => {
    useMixerStore.getState().forgetDrone('a')
    useMixerStore.getState().forgetDrone('b')
    useMixerStore.getState().bindDrone(null)
  })

  it('shows another drone an empty, unloaded table and restores the first on return', () => {
    const store = useMixerStore.getState
    store().bindDrone('a')
    useMixerStore.setState({ motorRules: [RULE], loaded: true })

    store().bindDrone('b')
    expect(store().motorRules).toEqual([])
    expect(store().loaded).toBe(false)

    store().bindDrone('a')
    expect(store().motorRules).toEqual([RULE])
    expect(store().loaded).toBe(true)
  })

  it('lands a read in the drone it was started for', async () => {
    const store = useMixerStore.getState
    store().bindDrone('a')
    const { protocol, resolve } = deferredProtocol()
    const read = store().loadFromFc(protocol)

    store().bindDrone('b')
    resolve([RULE])
    await read

    expect(store().motorRules).toEqual([])
    expect(store().loaded).toBe(false)
    store().bindDrone('a')
    expect(store().motorRules).toEqual([RULE])
    expect(store().loaded).toBe(true)
  })

  it('drops a removed drone\'s table', () => {
    const store = useMixerStore.getState
    store().bindDrone('a')
    useMixerStore.setState({ motorRules: [RULE], loaded: true })
    store().bindDrone('b')
    store().forgetDrone('a')
    store().bindDrone('a')
    expect(store().motorRules).toEqual([])
  })
})
