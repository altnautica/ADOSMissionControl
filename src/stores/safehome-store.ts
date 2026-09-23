/**
 * @module safehome-store
 * @description Zustand store for iNav safehome slots.
 * Manages the FC's safehome positions: read from FC, edit locally, write back.
 * @license GPL-3.0-only
 */

import { create } from 'zustand'
import type { DroneProtocol } from '@/lib/protocol/types'
import { INAV_LIMITS, type INavSafehome } from '@/lib/protocol/msp/msp-decoders-inav'
import { formatErrorMessage } from '@/lib/utils'
import { droneSlices, type DroneKeyed } from './drone-slices'

/** Safehome slots iNav has (MAX_SAFE_HOMES). */
export const SAFEHOME_MAX = INAV_LIMITS.SAFEHOMES

function defaultSafehome(index: number): INavSafehome {
  return { index, enabled: false, lat: 0, lon: 0 }
}

function defaultSlots(): INavSafehome[] {
  return Array.from({ length: SAFEHOME_MAX }, (_, i) => defaultSafehome(i))
}

interface SafehomeSlice {
  safehomes: INavSafehome[]
  activeIndex: number | null
  loading: boolean
  error: string | null
  dirty: boolean
  /** True once a read from the FC succeeded, even when every slot is empty. */
  loaded: boolean
}

const emptySlice = (): SafehomeSlice => ({
  safehomes: defaultSlots(), activeIndex: null, loading: false, error: null, dirty: false, loaded: false,
})

const slices = droneSlices<SafehomeSlice>(
  ['safehomes', 'activeIndex', 'loading', 'error', 'dirty', 'loaded'],
  emptySlice,
)

interface SafehomeStoreState extends SafehomeSlice, DroneKeyed<SafehomeSlice> {
  /** Show `droneId`'s slots (called when the selected drone changes). */
  bindDrone: (droneId: string | null) => void
  /** Drop a removed drone's slots. */
  forgetDrone: (droneId: string) => void
  // Actions
  setSlot: (index: number, partial: Partial<Omit<INavSafehome, 'index'>>) => void
  toggleEnabled: (index: number) => void
  setActiveIndex: (index: number | null) => void
  clear: () => void
  loadFromFc: (protocol: DroneProtocol) => Promise<void>
  uploadToFc: (protocol: DroneProtocol) => Promise<void>
}

export const useSafehomeStore = create<SafehomeStoreState>((set, get) => ({
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

  setSlot(index, partial) {
    const safehomes = [...get().safehomes]
    safehomes[index] = { ...safehomes[index], ...partial }
    set({ safehomes, dirty: true })
  },

  toggleEnabled(index) {
    const safehomes = [...get().safehomes]
    safehomes[index] = { ...safehomes[index], enabled: !safehomes[index].enabled }
    set({ safehomes, dirty: true })
  },

  setActiveIndex(index) {
    set({ activeIndex: index })
  },

  clear() {
    set(emptySlice())
  },

  async loadFromFc(protocol) {
    if (get().loading) return
    if (!protocol.downloadSafehomes) {
      set({ error: 'Safehomes not supported by this firmware' })
      return
    }
    const droneId = get().droneId
    set({ loading: true, error: null })
    try {
      const result = await protocol.downloadSafehomes()
      const safehomes = defaultSlots()
      for (const sh of result) {
        if (sh.index >= 0 && sh.index < SAFEHOME_MAX) {
          safehomes[sh.index] = sh
        }
      }
      set((st) => slices.patchFor(st, droneId, { safehomes, loading: false, dirty: false, loaded: true }))
    } catch (err) {
      set((st) => slices.patchFor(st, droneId, { loading: false, error: formatErrorMessage(err) }))
    }
  },

  async uploadToFc(protocol) {
    if (get().loading) return
    if (!protocol.uploadSafehomes) {
      set({ error: 'Safehomes not supported by this firmware' })
      return
    }
    const droneId = get().droneId
    set({ loading: true, error: null })
    try {
      const result = await protocol.uploadSafehomes(get().safehomes)
      set((st) => slices.patchFor(st, droneId, result.success
        ? { loading: false, dirty: false }
        : { loading: false, error: result.message }))
    } catch (err) {
      set((st) => slices.patchFor(st, droneId, { loading: false, error: formatErrorMessage(err) }))
    }
  },
}))
