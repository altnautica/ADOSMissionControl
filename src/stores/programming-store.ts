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
  INavGvarStatus,
  INavProgrammingPid,
  INavProgrammingPidStatus,
} from '@/lib/protocol/msp/msp-decoders-inav'
import { placeLogicProgram, type PlacementResult } from '@/lib/inav/lc-placement'
import { formatErrorMessage } from '@/lib/utils'
import { droneSlices, type DroneKeyed } from './drone-slices'

export const LOGIC_CONDITION_MAX = 64
export const GVAR_MAX = 8
export const PROGRAMMING_PID_MAX = 4

/** Delay before the next status poll after a request failed: a fixed retry so a
 *  slow or dropping link is not handed a new request every poll interval. */
export const STATUS_POLL_RETRY_MS = 2000

/** What one status request in a poll produced. */
export type StatusPollResult = 'ok' | 'failed' | 'unsupported'

export interface StatusPollOutcome {
  conditions: StatusPollResult
  gvars: StatusPollResult
  pids: StatusPollResult
}

function defaultLogicCondition(): INavLogicCondition {
  return {
    enabled: false,
    // -1: no activator, the condition always evaluates.
    activatorId: -1,
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
  /** Live value of each logic condition, by slot. */
  conditionsStatus: number[]
  gvarStatus: INavGvarStatus
  pids: INavProgrammingPid[]
  pidStatus: INavProgrammingPidStatus[]
  /** When each status was last read from the FC (ms epoch); null = never. */
  conditionsStatusAt: number | null
  gvarStatusAt: number | null
  pidStatusAt: number | null

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
  conditionsStatusAt: null,
  gvarStatusAt: null,
  pidStatusAt: null,
  loading: false,
  error: null,
  conditionsDirty: false,
  pidsDirty: false,
  loaded: false,
})

const slices = droneSlices<ProgrammingSlice>(
  [
    'conditions', 'conditionsStatus', 'gvarStatus', 'pids', 'pidStatus',
    'conditionsStatusAt', 'gvarStatusAt', 'pidStatusAt',
    'loading', 'error', 'conditionsDirty', 'pidsDirty', 'loaded',
  ],
  emptySlice,
)

interface ProgrammingStoreState extends ProgrammingSlice, DroneKeyed<ProgrammingSlice> {
  /** Show `droneId`'s programming (called when the selected drone changes). */
  bindDrone: (droneId: string | null) => void
  /** Drop a removed drone's programming. */
  forgetDrone: (droneId: string) => void

  pollingTimer: ReturnType<typeof setTimeout> | null

  setCondition: (index: number, partial: Partial<INavLogicCondition>) => void
  setPid: (index: number, partial: Partial<INavProgrammingPid>) => void
  /**
   * Put a compiled program into the free slots of the table read from the FC,
   * leaving every slot in use untouched. Refuses before a read, and when the
   * table has too few free slots.
   */
  placeProgram: (program: INavLogicCondition[]) => PlacementResult
  clear: () => void

  loadFromFc: (protocol: DroneProtocol) => Promise<void>
  /** Resolves true only when every condition was written and saved. */
  uploadConditions: (protocol: DroneProtocol) => Promise<boolean>
  /** Resolves true only when every PID was written and saved. */
  uploadPids: (protocol: DroneProtocol) => Promise<boolean>
  writeGvar: (protocol: DroneProtocol, index: number, value: number) => Promise<void>

  /** Poll status on a chain: the next poll is scheduled once the previous one
   *  settles, `intervalMs` after success and STATUS_POLL_RETRY_MS after a failure. */
  startPolling: (protocol: DroneProtocol, intervalMs?: number) => void
  stopPolling: () => void
  /** Read every status once. A call while a poll is in flight joins it. */
  pollStatus: (protocol: DroneProtocol) => Promise<StatusPollOutcome>
}

/** The poll currently running, per protocol, so overlapping callers share it. */
let pollInFlight: { protocol: DroneProtocol; outcome: Promise<StatusPollOutcome> } | null = null

function pollResult<T>(r: PromiseSettledResult<T | undefined>): StatusPollResult {
  if (r.status === 'rejected') return 'failed'
  return r.value === undefined ? 'unsupported' : 'ok'
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

  placeProgram(program) {
    if (!get().loaded) {
      return { error: 'Read the logic conditions from the flight controller first, so slots in use are kept' }
    }
    const placed = placeLogicProgram(get().conditions, program)
    if ('conditions' in placed) set({ conditions: placed.conditions, conditionsDirty: true })
    return placed
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

  pollStatus(protocol) {
    if (pollInFlight?.protocol === protocol) return pollInFlight.outcome
    const droneId = get().droneId
    const run = async (): Promise<StatusPollOutcome> => {
      const [lc, gv, pid] = await Promise.allSettled([
        protocol.downloadLogicConditionsStatus?.(),
        protocol.downloadGvarStatus?.(),
        protocol.downloadProgrammingPidStatus?.(),
      ])
      // A failed request keeps the last value and its read time, so the
      // panels can tell a live value from an old one.
      const now = Date.now()
      const patch: Partial<ProgrammingSlice> = {}
      if (lc.status === 'fulfilled' && lc.value !== undefined) {
        patch.conditionsStatus = lc.value
        patch.conditionsStatusAt = now
      }
      if (gv.status === 'fulfilled' && gv.value !== undefined) {
        patch.gvarStatus = gv.value
        patch.gvarStatusAt = now
      }
      if (pid.status === 'fulfilled' && pid.value !== undefined) {
        patch.pidStatus = pid.value
        patch.pidStatusAt = now
      }
      set((st) => slices.patchFor(st, droneId, patch))
      return { conditions: pollResult(lc), gvars: pollResult(gv), pids: pollResult(pid) }
    }
    const outcome = run().finally(() => {
      if (pollInFlight?.outcome === outcome) pollInFlight = null
    })
    pollInFlight = { protocol, outcome }
    return outcome
  },

  startPolling(protocol, intervalMs = 500) {
    if (get().pollingTimer !== null) return
    const schedule = (delay: number) => {
      const timer = setTimeout(async () => {
        const outcome = await get().pollStatus(protocol)
        // Stopped, or restarted for another protocol, while the poll ran.
        if (get().pollingTimer !== timer) return
        const failed = outcome.conditions === 'failed' || outcome.gvars === 'failed' || outcome.pids === 'failed'
        schedule(failed ? STATUS_POLL_RETRY_MS : intervalMs)
      }, delay)
      set({ pollingTimer: timer })
    }
    schedule(intervalMs)
  },

  stopPolling() {
    const timer = get().pollingTimer
    if (timer !== null) {
      clearTimeout(timer)
      set({ pollingTimer: null })
    }
  },
}))
