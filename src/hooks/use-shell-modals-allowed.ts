/**
 * @module hooks/use-shell-modals-allowed
 * @description Whether the shell may open its own modals (welcome, disclaimer,
 * What's New). Never while a flight screen is mounted or any connected vehicle
 * reports armed: a modal must not cover a cockpit or STOP. Callers keep their
 * modal queued and open it once this turns true.
 *
 * A vehicle whose link drops reads arm state "unknown", and one whose
 * transport closes has no arm state at all; when it was last known armed it
 * may still be flying, so it keeps holding the modals for
 * {@link ARMED_LINK_LOST_HOLD_MS} after its last armed heartbeat. Only a
 * disarmed report releases it early. The seeded demo fleet boots armed in its
 * missions and never holds them; a demo cockpit still does, through the
 * flight screen.
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import { isDemoVehicle } from "@/lib/demo/demo-vehicles";
import { useFlightScreenStore } from "@/stores/flight-screen-store";
import { useNodeRegistryStore } from "@/stores/node-registry/node-registry-store";
import type { NodeEntry } from "@/stores/node-registry/types";

/** How long a vehicle last known armed keeps holding the shell modals after
 * its link drops, from its last heartbeat. */
export const ARMED_LINK_LOST_HOLD_MS = 5 * 60_000;

/** Last heartbeat (ms) of each vehicle while it reported armed; dropped on a
 * disarmed report or when the node leaves the registry. */
const lastArmedAt = new Map<string, number>();

function record(nodes: Record<string, NodeEntry>): void {
  for (const id of lastArmedAt.keys()) if (!(id in nodes)) lastArmedAt.delete(id);
  for (const [id, n] of Object.entries(nodes)) {
    const arm = n.fc?.armState;
    if (arm === "armed") lastArmedAt.set(id, n.fc.lastHeartbeat ?? Date.now());
    else if (arm === "disarmed") lastArmedAt.delete(id);
  }
}

// Track every registry change, not only while a shell is mounted: a link can
// drop before the hook's first render.
record(useNodeRegistryStore.getState().nodes);
useNodeRegistryStore.subscribe((s) => record(s.nodes));

/** Until when the vehicles hold the shell modals: 0 for no hold, Infinity
 * while one reports armed, else the end of a link-lost hold. */
function holdUntil(nodes: Record<string, NodeEntry>): number {
  let until = 0;
  for (const [id, n] of Object.entries(nodes)) {
    if (isDemoVehicle(id)) continue;
    const arm = n.fc?.armState;
    if (arm === "armed") return Infinity;
    const at = lastArmedAt.get(id);
    if (arm !== "disarmed" && at !== undefined) until = Math.max(until, at + ARMED_LINK_LOST_HOLD_MS);
  }
  return until;
}

export function useShellModalsAllowed(): boolean {
  const flightScreen = useFlightScreenStore((s) => s.mounted > 0);
  const until = useNodeRegistryStore((s) => holdUntil(s.nodes));
  const [now, setNow] = useState(() => Date.now());
  // Re-read the clock when a link-lost hold ends (at once when it already has).
  useEffect(() => {
    if (until === 0 || until === Infinity) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(0, until - Date.now()));
    return () => clearTimeout(t);
  }, [until]);
  return !flightScreen && until <= now;
}
