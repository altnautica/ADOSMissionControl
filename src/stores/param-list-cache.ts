/**
 * The full parameter list downloaded by the raw Parameters grid, kept per
 * drone so leaving and re-opening the page does not re-download a thousand
 * parameters.
 *
 * An entry belongs to one drone AND one protocol instance: a reconnect makes a
 * new protocol, so the old list no longer describes what the FC holds. Every
 * download takes a generation token, and a completion is kept only when its
 * token is still the drone's latest; a download superseded by a newer one, by
 * an invalidation, or by a reconnect is dropped instead of overwriting the
 * cache.
 *
 * @module stores/param-list-cache
 * @license GPL-3.0-only
 */

import type { DroneProtocol, ParameterValue } from "@/lib/protocol/types";

/** How long a downloaded list is served without re-reading the FC. */
export const PARAM_LIST_CACHE_TTL_MS = 300_000;

interface Entry {
  protocol: DroneProtocol | null;
  params: ParameterValue[] | null;
  storedAt: number;
  generation: number;
}

const entries = new Map<string, Entry>();
let nextGeneration = 1;

function entryFor(droneId: string): Entry {
  let entry = entries.get(droneId);
  if (!entry) {
    entry = { protocol: null, params: null, storedAt: 0, generation: 0 };
    entries.set(droneId, entry);
  }
  return entry;
}

/** The cached list for this drone and protocol, or null when absent, stale or
 * from another link. */
export function getCachedParamList(
  droneId: string,
  protocol: DroneProtocol,
  now: number = Date.now(),
): ParameterValue[] | null {
  const entry = entries.get(droneId);
  if (!entry?.params || entry.protocol !== protocol) return null;
  if (now - entry.storedAt >= PARAM_LIST_CACHE_TTL_MS) return null;
  return entry.params;
}

/** Start a download for a drone; the returned token must accompany the commit.
 * Any download started earlier for the same drone is superseded. */
export function beginParamDownload(droneId: string): number {
  const generation = nextGeneration++;
  entryFor(droneId).generation = generation;
  return generation;
}

/** Store a finished download. Returns false (and stores nothing) when the
 * download was superseded, so the caller also knows not to show it. */
export function commitParamDownload(
  droneId: string,
  protocol: DroneProtocol,
  generation: number,
  params: ParameterValue[],
  now: number = Date.now(),
): boolean {
  const entry = entries.get(droneId);
  if (!entry || entry.generation !== generation) return false;
  entry.protocol = protocol;
  entry.params = params;
  entry.storedAt = now;
  return true;
}

/** Replace the cached list after a write landed, only while it still belongs
 * to the same link. */
export function updateCachedParamList(
  droneId: string,
  protocol: DroneProtocol,
  params: ParameterValue[],
  now: number = Date.now(),
): void {
  const entry = entries.get(droneId);
  if (!entry || entry.protocol !== protocol) return;
  entry.params = params;
  entry.storedAt = now;
}

/** Forget one drone's list (its link went away), or every drone's list. Any
 * download in flight for the forgotten drones is superseded. */
export function invalidateParamList(droneId?: string): void {
  if (droneId === undefined) {
    entries.clear();
    return;
  }
  entries.delete(droneId);
}
