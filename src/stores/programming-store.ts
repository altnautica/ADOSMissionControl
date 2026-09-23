/**
 * @module programming-store
 * @description Zustand store for iNav Programming Framework.
 * Manages logic conditions (64 slots), global variables (8 slots),
 * and programming PIDs (4 slots). Includes live status polling.
 * @license GPL-3.0-only
 */

import { create } from 'zustand'
import type { DroneProtocol } from '@/lib/protocol/types'
import type {
  INavLogicCondition,
  INavLogicConditionsStatus,
  INavGvarStatus,
  INavProgrammingPid,
  INavProgrammingPidStatus,
} from '@/lib/protocol/msp/msp-decoders-inav'
import { formatErrorMessage } from '@/lib/utils'
import { droneSlices, type DroneKeyed } from './drone-slices'

export const LOGIC_CONDITION_MAX = 64
export const GVAR_MAX = 8
export const PROGRAMMING_PID_MAX = 4

function defaultLogicCondition(): INavLogicCondition {
  return {
    enabled: false,
    activatorId: 0,
    operation: 0,
    operandAType: 0,
    operandAValue: 0,
    operandBType: 0,
    operandBValue: 0,
    flags: 0,
  }
}

function defaultLogicConditions(): INavLogicCondition[] {
  return Array.from({ length: LOGIC_CONDITION_MAX }, () => defaultLogicCondition())
}

function defaultProgrammingPid(): INavProgrammingPid {
  return {
    enabled: false,
    setpointType: 0,
    setpointValue: 0,
    measurementType: 0,
    measurementValue: 0,
    gains: { P: 0, I: 0, D: 0, FF: 0 },
  }
}

function defaultProgrammingPids(): INavProgrammingPid[] {
  return Array.from({ length: PROGRAMMING_PID_MAX }, () => defaultProgrammingPid())
}

interface ProgrammingSlice {
  conditions: INavLogicCondition[]
  conditionsStatus: INavLogicConditionsStatus[]
  gvarStatus: INavGvarStatus
  pids: INavProgrammingPid[]
  pidStatus: INavProgrammingPidStatus[]

  loading: boolean
  error: string | null
  conditionsDirty: boolean
  pidsDirty: boolean
  /** True once a read from the FC succeeded, even when every slot is unused. */
  loaded: boolean
}

const emptySlice = (): ProgrammingSlice => ({
  conditions: defaultLogicConditions(),
  conditionsStatus: [],
  gvarStatus: { values: [] },
  pids: defaultProgrammingPids(),
  pidStatus: [],
  loading: false,
  error: null,
  conditionsDirty: false,
  pidsDirty: false,
  loaded: false,
})

const slices = droneSlices<ProgrammingSlice>(
  ['conditions', 'conditionsStatus', 'gvarStatus', 'pids', 'pidStatus', 'loading', 'error', 'conditionsDirty', 'pidsDirty', 'loaded'],
  emptySlice,
)

interface ProgrammingStoreState extends ProgrammingSlice, DroneKeyed<ProgrammingSlice> {
  /** Show `droneId`'s programming (called when the selected drone changes). */
  bindDrone: (droneId: string | null) => void
  /** Drop a removed drone's programming. */
  forgetDrone: (droneId: string) => void

  pollingTimer: ReturnType<typeof setInterval> | null

  setCondition: (index: number, partial: Partial<INavLogicCondition>) => void
  setPid: (index: number, partial: Partial<INavProgrammingPid>) => void
  loadConditions: (conditions: INavLogicCondition[]) => void
  clear: () => void

  loadFromFc: (protocol: DroneProtocol) => Promise<void>
  /** Resolves true only when every condition was written and saved. */
  uploadConditions: (protocol: DroneProtocol) => Promise<boolean>
  /** Resolves true only when every PID was written and saved. */
  uploadPids: (protocol: DroneProtocol) => Promise<boolean>
  writeGvar: (protocol: DroneProtocol, index: number, value: number) => Promise<void>

  startPolling: (protocol: DroneProtocol, intervalMs?: number) => void
  stopPolling: () => void
  pollStatus: (protocol: DroneProtocol) => Promise<void>
}

export const useProgrammingStore = create<ProgrammingStoreState>((set, get) => ({
  ...emptySlice(),
  droneId: null,
  byDrone: new Map(),

  pollingTimer: null,

  bindDrone(droneId) {
    const patch = slices.bind(get(), droneId)
    if (!patch) return
    // Status polling runs against one drone's protocol; the panel restarts it.
    get().stopPolling()
    set(patch)
  },

  forgetDrone(droneId) {
    const patch = slices.forget(get(), droneId)
    if (patch) set(patch)
  },

  setCondition(index, partial) {
    const conditions = [...get().conditions]
    conditions[index] = { ...conditions[index], ...partial }
    set({ conditions, conditionsDirty: true })
  },

  setPid(index, partial) {
    const pids = [...get().pids]
    pids[index] = { ...pids[index], ...partial }
    set({ pids, pidsDirty: true })
  },

  loadConditions(conditions) {
    const next = defaultLogicConditions()
    conditions.forEach((c, i) => {
      if (i < LOGIC_CONDITION_MAX) next[i] = c
    })
    set({ conditions: next, conditionsDirty: true })
  },

  clear() {
    get().stopPolling()
    set(emptySlice())
  },

  async loadFromFc(protocol) {
    if (get().loading) return
    if (!protocol.downloadLogicConditions || !protocol.downloadProgrammingPids) {
      set({ error: 'Programming framework not supported by this firmware' })
      return
    }
    const droneId = get().droneId
    set({ loading: true, error: null })
    try {
      const [rawConditions, rawPids] = await Promise.all([
        protocol.downloadLogicConditions(),
        protocol.downloadProgrammingPids(),
      ])

      const conditions = defaultLogicConditions()
      rawConditions.forEach((c, i) => {
        if (i < LOGIC_CONDITION_MAX) conditions[i] = c
      })

      const pids = defaultProgrammingPids()
      rawPids.forEach((p, i) => {
        if (i < PROGRAMMING_PID_MAX) pids[i] = p
      })

      set((st) => slices.patchFor(st, droneId, { conditions, pids, loading: false, conditionsDirty: false, pidsDirty: false, loaded: true }))
    } catch (err) {
      set((st) => slices.patchFor(st, droneId, { loading: false, error: formatErrorMessage(err) }))
    }
  },

  async uploadConditions(protocol) {
    if (get().loading) return false
    if (!protocol.uploadLogicConditions) {
      set({ error: 'Logic condition upload not supported' })
      return false
    }
    const droneId = get().droneId
    set({ loading: true, error: null })
    try {
      const result = await protocol.uploadLogicConditions(get().conditions)
      set((st) => slices.patchFor(st, droneId, result.success
        ? { loading: false, conditionsDirty: false }
        : { loading: false, error: result.message }))
      return result.success
    } catch (err) {
      set((st) => slices.patchFor(st, droneId, { loading: false, error: formatErrorMessage(err) }))
      return false
    }
  },

  async uploadPids(protocol) {
    if (get().loading) return false
    if (!protocol.uploadProgrammingPids) {
      set({ error: 'Programming PID upload not supported' })
      return false
    }
    const droneId = get().droneId
    set({ loading: true, error: null })
    try {
      const result = await protocol.uploadProgrammingPids(get().pids)
      set((st) => slices.patchFor(st, droneId, result.success
        ? { loading: false, pidsDirty: false }
        : { loading: false, error: result.message }))
      return result.success
    } catch (err) {
      set((st) => slices.patchFor(st, droneId, { loading: false, error: formatErrorMessage(err) }))
      return false
    }
  },

  async writeGvar(protocol, index, value) {
    if (!protocol.setGvar) {
      set({ error: 'Global variable set not supported by this firmware' })
      return
    }
    set({ error: null })
    try {
      const res = await protocol.setGvar(index, value)
      if (!res.success) {
        set({ error: res.message })
        return
      }
      // reflect the newly-set value locally until the next status poll
      const values = [...get().gvarStatus.values]
      values[index] = value
      set({ gvarStatus: { values } })
    } catch (err) {
      set({ error: formatErrorMessage(err) })
    }
  },

  async pollStatus(protocol) {
    const droneId = get().droneId
    try {
      const results = await Promise.allSettled([
        protocol.downloadLogicConditionsStatus?.() ?? Promise.resolve([]),
        protocol.downloadGvarStatus?.() ?? Promise.resolve({ values: [] }),
        protocol.downloadProgrammingPidStatus?.() ?? Promise.resolve([]),
      ])

      const conditionsStatus =
        results[0].status === 'fulfilled' ? (results[0].value as INavLogicConditionsStatus[]) : get().conditionsStatus
      const gvarStatus =
        results[1].status === 'fulfilled' ? (results[1].value as INavGvarStatus) : get().gvarStatus
      const pidStatus =
        results[2].status === 'fulfilled' ? (results[2].value as INavProgrammingPidStatus[]) : get().pidStatus

      set((st) => slices.patchFor(st, droneId, { conditionsStatus, gvarStatus, pidStatus }))
    } catch {
      // status polling is best-effort
    }
  },

  startPolling(protocol, intervalMs = 500) {
    const existing = get().pollingTimer
    if (existing !== null) return
    const timer = setInterval(() => {
      get().pollStatus(protocol)
    }, intervalMs)
    set({ pollingTimer: timer })
  },

  stopPolling() {
    const timer = get().pollingTimer
    if (timer !== null) {
      clearInterval(timer)
      set({ pollingTimer: null })
    }
  },
}))
