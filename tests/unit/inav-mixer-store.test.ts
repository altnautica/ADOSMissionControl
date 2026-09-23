/**
 * Tests for useMixerStore.
 *
 * Uses a minimal fake DroneProtocol that resolves with pre-set fixture data
 * so the tests run offline without a flight controller.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMixerStore } from '@/stores/mixer-store'
import type { DroneProtocol } from '@/lib/protocol/types'
import type { MotorMixerRule, INavServoMixerRule } from '@/lib/protocol/msp/msp-decoders-inav'

function makeMotorRule(throttle = 1, roll = 0.5, pitch = -0.5, yaw = 0): MotorMixerRule {
  return { throttle, roll, pitch, yaw }
}

function makeServoRule(targetChannel = 0, inputSource = 0, rate = 100, speed = 0, conditionId = 0): INavServoMixerRule {
  return { targetChannel, inputSource, rate, speed, conditionId }
}

function makeFakeProtocol(
  motorRules: MotorMixerRule[] = [],
  servoRules: INavServoMixerRule[] = [],
  slots = { maxSupportedMotors: 12, maxSupportedServos: 18 },
): Partial<DroneProtocol> {
  return {
    downloadMotorMixer: vi.fn().mockResolvedValue(motorRules),
    downloadServoMixer: vi.fn().mockResolvedValue(servoRules),
    getMixerConfig: vi.fn().mockResolvedValue({
      motorDirectionInverted: false, motorstopOnLow: false, platformType: 0, hasFlaps: false,
      appliedMixerPreset: 0, ...slots,
    }),
    uploadMotorMixer: vi.fn().mockResolvedValue(undefined),
    uploadServoMixer: vi.fn().mockResolvedValue(undefined),
  }
}

describe('useMixerStore', () => {
  beforeEach(() => {
    useMixerStore.getState().clear()
  })

  it('initialises with empty rule arrays and clean state', () => {
    const { motorRules, servoRules, loading, error, dirty } = useMixerStore.getState()
    expect(motorRules).toHaveLength(0)
    expect(servoRules).toHaveLength(0)
    expect(loading).toBe(false)
    expect(error).toBeNull()
    expect(dirty).toBe(false)
  })

  it('adds no rule before the FC has reported its slot counts', () => {
    useMixerStore.getState().addMotorRule(makeMotorRule())
    useMixerStore.getState().addServoRule(makeServoRule())
    expect(useMixerStore.getState().motorRules).toHaveLength(0)
    expect(useMixerStore.getState().servoRules).toHaveLength(0)
  })

  it('caps the motor table at the slot count the FC reports', async () => {
    const proto = makeFakeProtocol([], [], { maxSupportedMotors: 8, maxSupportedServos: 18 })
    await useMixerStore.getState().loadFromFc(proto as DroneProtocol)
    for (let i = 0; i < 12; i++) useMixerStore.getState().addMotorRule(makeMotorRule(0.5))
    expect(useMixerStore.getState().motorRules).toHaveLength(8)
  })

  it('caps the servo table at two rules per servo the FC reports', async () => {
    const proto = makeFakeProtocol([], [], { maxSupportedMotors: 8, maxSupportedServos: 4 })
    await useMixerStore.getState().loadFromFc(proto as DroneProtocol)
    for (let i = 0; i < 20; i++) useMixerStore.getState().addServoRule(makeServoRule(i % 4))
    expect(useMixerStore.getState().servoRules).toHaveLength(8)
  })

  it('setMotorRule updates the rule at the given index and marks dirty', async () => {
    await useMixerStore.getState().loadFromFc(makeFakeProtocol() as DroneProtocol)
    useMixerStore.getState().addMotorRule(makeMotorRule(1, 0, 0, 0))
    useMixerStore.getState().setMotorRule(0, { roll: 0.75 })
    const { motorRules, dirty } = useMixerStore.getState()
    expect(motorRules[0].roll).toBe(0.75)
    expect(motorRules[0].throttle).toBe(1)
    expect(dirty).toBe(true)
  })

  it('removeMotorRule deletes the entry at the given index', async () => {
    await useMixerStore.getState().loadFromFc(makeFakeProtocol() as DroneProtocol)
    useMixerStore.getState().addMotorRule(makeMotorRule(1))
    useMixerStore.getState().addMotorRule(makeMotorRule(2))
    useMixerStore.getState().removeMotorRule(0)
    expect(useMixerStore.getState().motorRules).toHaveLength(1)
    expect(useMixerStore.getState().motorRules[0].throttle).toBe(2)
  })

  it('loadFromFc populates both tables and clears dirty flag', async () => {
    const motors = [makeMotorRule(1), makeMotorRule(2)]
    const servos = [makeServoRule(0, 1, 100)]
    const proto = makeFakeProtocol(motors, servos)
    await useMixerStore.getState().loadFromFc(proto as DroneProtocol)
    const { motorRules, servoRules, dirty, loading } = useMixerStore.getState()
    expect(motorRules).toHaveLength(2)
    expect(servoRules).toHaveLength(1)
    expect(dirty).toBe(false)
    expect(loading).toBe(false)
  })

  it('concurrent loadFromFc calls are guarded: second is ignored while first is in flight', async () => {
    const motors = [makeMotorRule()]
    const proto = makeFakeProtocol(motors, [])
    const first = useMixerStore.getState().loadFromFc(proto as DroneProtocol)
    const second = useMixerStore.getState().loadFromFc(proto as DroneProtocol)
    await Promise.all([first, second])
    expect(proto.downloadMotorMixer).toHaveBeenCalledTimes(1)
  })
})
