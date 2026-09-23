/**
 * @module inav-config-binding
 * @description Keeps the per-drone iNav config stores (mixer, geozones,
 * safehomes, programming) on the selected drone, and drops a drone's tables
 * when it is removed.
 * @license GPL-3.0-only
 */

import { useMixerStore } from './mixer-store'
import { useGeozoneStore } from './geozone-store'
import { useSafehomeStore } from './safehome-store'
import { useProgrammingStore } from './programming-store'

const STORES = [useMixerStore, useGeozoneStore, useSafehomeStore, useProgrammingStore] as const

/** Show `droneId`'s tables in every iNav config store. */
export function bindInavConfigStores(droneId: string | null): void {
  for (const store of STORES) store.getState().bindDrone(droneId)
}

/** Drop a removed drone's tables from every iNav config store. */
export function forgetInavConfigStores(droneId: string): void {
  for (const store of STORES) store.getState().forgetDrone(droneId)
}
