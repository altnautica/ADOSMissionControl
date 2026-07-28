"use client";

/**
 * @module SwarmBeaconBridge
 * @description The single feed into `swarm-beacon-store`. Polls every
 * LAN-paired ground station's `GET /api/swarm/neighbors` at the bus rate
 * (2 Hz) and upserts the decoded beacon rows keyed by fleet slot.
 *
 * Ground stations are read from the LAN-paired store, matching
 * `RelayedDroneBridge`: this is the local-first direct path (Rule 39), and a
 * cloud-paired ground station has no browser-reachable host to poll.
 *
 * Two behaviours that are not optional:
 *
 *   - A stale row is EVICTED, never dimmed and kept. Every tick prunes rows
 *     past `SWARM_BEACON_STALE_MS` against the GCS clock, so a drone whose bus
 *     died disappears from the board within 3 s even if the ground station
 *     keeps listing it. Rendering a dead aircraft's last position as current is
 *     the failure Rule 44 exists to prevent.
 *   - A dead host is BACKED OFF, never hammered. Consecutive no-answers double
 *     the interval up to `MAX_POLL_MS`; the first real answer snaps it back to
 *     2 Hz. Without this the bridge would fire 172 800 doomed requests an hour
 *     at a powered-off ground station.
 *
 * Renders nothing — pure bridge component, mounted once in `CommandShell`
 * beside the presence bridges.
 *
 * @license GPL-3.0-only
 */

import { useEffect } from "react";

import { useLocalNodesStore } from "@/stores/local-nodes-store";
import {
  useSwarmBeaconStore,
  SWARM_BEACON_STALE_MS,
  type SwarmBeaconRow,
} from "@/stores/swarm-beacon-store";
import {
  fetchSwarmNeighbors,
  type SwarmNeighborsSnapshot,
} from "@/lib/agent/swarm-neighbors-client";

/** The swarm bus beacons at 2 Hz, so polling faster buys nothing. */
const POLL_MS = 500;

/** Backoff ceiling for a ground station that stops answering. */
const MAX_POLL_MS = 8000;

/** One poll round folded into a single write. */
export interface MergedSwarmPoll {
  rows: SwarmBeaconRow[];
  /** The snapshot whose `fleetId` / `counters` are written alongside the rows.
   * With several ground stations these are fleet-wide facts, so any provisioned
   * answer will do — but a snapshot whose bus is not running (`fleetId: null`)
   * is never chosen over one that is, or a healthy receiver's identity would be
   * discarded in favour of a booting node's absence of one. */
  snapshot: SwarmNeighborsSnapshot;
}

/**
 * Merge one poll round's snapshots into a single row set. Two ground stations
 * in the same fleet hear the same aircraft, so the freshest report of a slot
 * wins — taking the last writer instead would let a distant receiver's aged
 * copy overwrite a close one's current fix.
 */
export function mergeSnapshots(
  snapshots: readonly SwarmNeighborsSnapshot[],
): MergedSwarmPoll | null {
  if (snapshots.length === 0) return null;

  const bySlot = new Map<number, SwarmBeaconRow>();
  for (const snap of snapshots) {
    for (const row of snap.rows) {
      const seen = bySlot.get(row.slot);
      if (!seen || row.ageMs < seen.ageMs) bySlot.set(row.slot, row);
    }
  }
  const provisioned = snapshots.find((snap) => snap.fleetId !== null);
  return {
    rows: Array.from(bySlot.values()),
    snapshot: provisioned ?? snapshots[0],
  };
}

export function SwarmBeaconBridge() {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let intervalMs = POLL_MS;

    async function pollOnce() {
      const groundStations = useLocalNodesStore
        .getState()
        .nodes.filter((n) => n.profile === "ground-station");

      // No ground station paired at all: nothing can be beaconing to us, so
      // the board must be empty rather than frozen on the last fleet seen.
      if (groundStations.length === 0) {
        const store = useSwarmBeaconStore.getState();
        if (store.lastUpdatedMs !== null) store.clear();
        intervalMs = MAX_POLL_MS;
        return;
      }

      const now = Date.now();
      const results = await Promise.all(
        groundStations.map((gs) =>
          fetchSwarmNeighbors(gs.hostname, gs.apiKey, now),
        ),
      );
      if (cancelled) return;

      const merged = mergeSnapshots(
        results.filter((r): r is SwarmNeighborsSnapshot => r !== null),
      );

      if (!merged) {
        // Nobody answered. Keep whatever rows are still inside the stale
        // window (a single dropped poll is not a fleet-wide outage) and let
        // the prune below retire them on schedule.
        intervalMs = Math.min(intervalMs * 2, MAX_POLL_MS);
        return;
      }

      const { fleetId, counters } = merged.snapshot;
      if (fleetId === null) {
        // Answered, but no ground station in reach is running a swarm bus, so
        // there is no fleet identity to record. Writing the config default 1
        // here would make an unprovisioned node look like a healthy fleet-1
        // node that had simply heard nobody — the exact confusion the route
        // returns null to prevent. Drop the board and back off: a node with no
        // bus has nothing to poll for, and the ramp to MAX_POLL_MS still
        // notices the bus coming up well inside a boot.
        const store = useSwarmBeaconStore.getState();
        if (store.lastUpdatedMs !== null) store.clear();
        intervalMs = Math.min(intervalMs * 2, MAX_POLL_MS);
        return;
      }

      intervalMs = POLL_MS;
      useSwarmBeaconStore.getState().upsertBeacons(merged.rows, fleetId, counters);
    }

    async function tick() {
      await pollOnce();
      if (cancelled) return;
      // Prune on every tick, including the backed-off ones, so eviction is
      // driven by the GCS clock rather than by a poll happening to succeed.
      useSwarmBeaconStore.getState().dropStale(Date.now(), SWARM_BEACON_STALE_MS);
      timer = setTimeout(tick, intervalMs);
    }

    tick();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      useSwarmBeaconStore.getState().clear();
    };
  }, []);

  return null;
}
