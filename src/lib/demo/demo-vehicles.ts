/**
 * @module lib/demo/demo-vehicles
 * @description The node ids of the vehicles the demo engine seeds and flies.
 * The demo fleet boots with drones armed in their missions; surfaces that
 * wait for the operator's own armed vehicles (the shell's modals) skip these.
 * Written by the demo engine while it runs, read by always-on code, so it
 * must stay free of any mock import.
 * @license GPL-3.0-only
 */

const ids = new Set<string>();

/** Record node ids as demo vehicles. */
export function markDemoVehicles(nodeIds: Iterable<string>): void {
  for (const id of nodeIds) ids.add(id);
}

/** Forget every demo vehicle (the demo engine stopped). */
export function clearDemoVehicles(): void {
  ids.clear();
}

/** Whether `nodeId` is a vehicle the demo engine seeded. */
export function isDemoVehicle(nodeId: string): boolean {
  return ids.has(nodeId);
}
