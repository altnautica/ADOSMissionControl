/**
 * @module drone-slices
 * @description Per-drone state for stores that hold one flight controller's
 * config (iNav mixer, geozones, safehomes, programming).
 *
 * The store's top-level fields always belong to `droneId`, the selected
 * drone, so panels keep reading them directly. Selecting another drone parks
 * the current slice under its id and restores the new drone's slice (or an
 * empty one), so a table read from one aircraft is never shown for, or
 * written to, another. An async read or write captures the drone id it
 * started for and lands its result in that drone's slice, wherever it is.
 * @license GPL-3.0-only
 */

export interface DroneKeyed<S> {
  /** Drone the top-level slice fields belong to. */
  droneId: string | null
  /** Slices of the other drones, by drone id. */
  byDrone: ReadonlyMap<string, S>
}

export interface DroneSlices<S> {
  /** Park the current slice and restore `next`'s. Null when already bound. */
  bind(state: S & DroneKeyed<S>, next: string | null): Partial<S & DroneKeyed<S>> | null
  /** Drop a drone's slice (the drone was removed). */
  forget(state: S & DroneKeyed<S>, droneId: string): Partial<S & DroneKeyed<S>> | null
  /**
   * Apply `patch` to `droneId`'s slice: the top-level fields when it is the
   * bound drone, its parked slice otherwise, nothing when it was forgotten.
   */
  patchFor(state: S & DroneKeyed<S>, droneId: string | null, patch: Partial<S>): Partial<S & DroneKeyed<S>>
}

/**
 * Build one store patch: the slice fields (when replacing the whole slice)
 * plus the keyed fields. The keyed fields type on their own, so a patch that
 * only moves the map (`{ byDrone }`) still assigns to the merged partial.
 */
function slicePatch<S extends object>(slice: S, keyed: Partial<DroneKeyed<S>>): Partial<S & DroneKeyed<S>> {
  const out: Partial<S & DroneKeyed<S>> = { ...slice, ...keyed }
  return out
}

export function droneSlices<S extends object>(keys: readonly (keyof S)[], empty: () => S): DroneSlices<S> {
  const pick = (state: S): S => {
    const out = {} as S
    for (const k of keys) out[k] = state[k]
    return out
  }
  return {
    bind(state, next) {
      if (state.droneId === next) return null
      const byDrone = new Map(state.byDrone)
      if (state.droneId !== null) byDrone.set(state.droneId, pick(state))
      const restored = (next !== null ? byDrone.get(next) : undefined) ?? empty()
      if (next !== null) byDrone.delete(next)
      return slicePatch(restored, { droneId: next, byDrone })
    },
    forget(state, droneId) {
      if (state.droneId === droneId) return slicePatch(empty(), { droneId: null })
      if (!state.byDrone.has(droneId)) return null
      const byDrone = new Map(state.byDrone)
      byDrone.delete(droneId)
      return slicePatch({} as S, { byDrone })
    },
    patchFor(state, droneId, patch) {
      if (state.droneId === droneId) return patch
      const parked = droneId !== null ? state.byDrone.get(droneId) : undefined
      if (!parked || droneId === null) return {}
      const byDrone = new Map(state.byDrone)
      byDrone.set(droneId, { ...parked, ...patch })
      return slicePatch({} as S, { byDrone })
    },
  }
}
