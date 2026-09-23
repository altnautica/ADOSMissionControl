/**
 * @module mixer-store
 * @description Zustand store for the iNav motor and servo mixer tables.
 * Read from FC, edit locally, write back. The editor holds at most as many
 * rules as the FC reports slots for (MSP2_INAV_MIXER).
 * @license GPL-3.0-only
 */

import { create } from 'zustand'
import type { DroneProtocol } from '@/lib/protocol/types'
import type { MotorMixerRule, INavServoMixerRule } from '@/lib/protocol/msp/msp-decoders-inav'
import { formatErrorMessage } from '@/lib/utils'
import { droneSlices, type DroneKeyed } from './drone-slices'

interface MixerSlice {
  motorRules: MotorMixerRule[]
  servoRules: INavServoMixerRule[]
  loading: boolean
  error: string | null
  dirty: boolean
  /** A read from this drone's FC has succeeded. */
  loaded: boolean
  /** Motor rule slots the FC reports (MAX_SUPPORTED_MOTORS); null until read. */
  motorSlots: number | null
  /** Servo rule slots the FC reports (2 x MAX_SUPPORTED_SERVOS); null until read. */
  servoSlots: number | null
}

const emptySlice = (): MixerSlice => ({
  motorRules: [], servoRules: [], loading: false, error: null, dirty: false, loaded: false,
  motorSlots: null, servoSlots: null,
})

const slices = droneSlices<MixerSlice>(
  ['motorRules', 'servoRules', 'loading', 'error', 'dirty', 'loaded', 'motorSlots', 'servoSlots'],
  emptySlice,
)

interface MixerState extends MixerSlice, DroneKeyed<MixerSlice> {
  /** Show `droneId`'s tables (called when the selected drone changes). */
  bindDrone: (droneId: string | null) => void
  /** Drop a removed drone's tables. */
  forgetDrone: (droneId: string) => void

  setMotorRule: (idx: number, partial: Partial<MotorMixerRule>) => void
  removeMotorRule: (idx: number) => void
  addMotorRule: (rule: MotorMixerRule) => void
  setServoRule: (idx: number, partial: Partial<INavServoMixerRule>) => void
  removeServoRule: (idx: number) => void
  addServoRule: (rule: INavServoMixerRule) => void
  loadFromFc: (protocol: DroneProtocol) => Promise<void>
  uploadToFc: (protocol: DroneProtocol) => Promise<void>
  clear: () => void
}

export const useMixerStore = create<MixerState>((set, get) => ({
  ...emptySlice(),
  droneId: null,
  byDrone: new Map(),

  bindDrone(droneId) {
    const patch = slices.bind(get(), droneId)
    if (patch) set(patch)
  },

  forgetDrone(droneId) {
    const patch = slices.forget(get(), droneId)
    if (patch) set(patch)
  },

  setMotorRule(idx, partial) {
    const motorRules = [...get().motorRules]
    if (idx < 0 || idx >= motorRules.length) return
    motorRules[idx] = { ...motorRules[idx], ...partial }
    set({ motorRules, dirty: true })
  },

  removeMotorRule(idx) {
    const motorRules = get().motorRules.filter((_, i) => i !== idx)
    set({ motorRules, dirty: true })
  },

  addMotorRule(rule) {
    const { motorRules, motorSlots } = get()
    if (motorSlots === null || motorRules.length >= motorSlots) return
    set({ motorRules: [...motorRules, rule], dirty: true })
  },

  setServoRule(idx, partial) {
    const servoRules = [...get().servoRules]
    if (idx < 0 || idx >= servoRules.length) return
    servoRules[idx] = { ...servoRules[idx], ...partial }
    set({ servoRules, dirty: true })
  },

  removeServoRule(idx) {
    const servoRules = get().servoRules.filter((_, i) => i !== idx)
    set({ servoRules, dirty: true })
  },

  addServoRule(rule) {
    const { servoRules, servoSlots } = get()
    if (servoSlots === null || servoRules.length >= servoSlots) return
    set({ servoRules: [...servoRules, rule], dirty: true })
  },

  async loadFromFc(protocol) {
    if (get().loading) return
    if (!protocol.downloadMotorMixer || !protocol.downloadServoMixer || !protocol.getMixerConfig) {
      set({ error: 'Mixer tables not supported by this firmware' })
      return
    }
    const droneId = get().droneId
    set({ loading: true, error: null })
    try {
      const [motorRules, servoRules, cfg] = await Promise.all([
        protocol.downloadMotorMixer(),
        protocol.downloadServoMixer(),
        protocol.getMixerConfig(),
      ])
      set((st) => slices.patchFor(st, droneId, {
        motorRules, servoRules, loading: false, dirty: false, loaded: true,
        motorSlots: cfg.maxSupportedMotors, servoSlots: 2 * cfg.maxSupportedServos,
      }))
    } catch (err) {
      set((st) => slices.patchFor(st, droneId, { loading: false, error: formatErrorMessage(err) }))
    }
  },

  async uploadToFc(protocol) {
    if (get().loading) return
    if (!protocol.uploadMotorMixer || !protocol.uploadServoMixer) {
      set({ error: 'Mixer tables not supported by this firmware' })
      return
    }
    const { motorRules, servoRules } = get()
    // The FC counts motors up to the first rule with throttle 0, so such a rule
    // would silently drop itself and every motor after it.
    const unusedAt = motorRules.findIndex((r) => r.throttle === 0)
    if (unusedAt >= 0) {
      set({ error: `Motor rule ${unusedAt} has throttle 0, which the flight controller reads as the end of the motor table` })
      return
    }
    // Likewise the FC stops loading servo rules at the first rate-0 rule.
    const emptyServoAt = servoRules.findIndex((r) => r.rate === 0)
    if (emptyServoAt >= 0) {
      set({ error: `Servo rule ${emptyServoAt} has rate 0, which the flight controller reads as the end of the servo table` })
      return
    }
    const droneId = get().droneId
    set({ loading: true, error: null })
    try {
      await protocol.uploadMotorMixer(motorRules)
      await protocol.uploadServoMixer(servoRules)
      set((st) => slices.patchFor(st, droneId, { loading: false, dirty: false }))
    } catch (err) {
      set((st) => slices.patchFor(st, droneId, { loading: false, error: formatErrorMessage(err) }))
    }
  },

  clear() {
    set(emptySlice())
  },
}))
