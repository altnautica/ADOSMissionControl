/**
 * @module waypoint-clipboard
 * @description A tiny, module-level clipboard for planner waypoints. Copy stores
 * a snapshot of the selected waypoints here; paste reads them back. It lives
 * outside any store so the keyboard dispatcher and the planner page can share
 * one clipboard without a store round-trip, and so a copied set survives an
 * unrelated re-render.
 *
 * Every read and write deep-copies the waypoints, attached actions included,
 * and gives each action a fresh id, so a caller can freely mutate what it
 * copied in or reads out, and two pastes never share an action array or id.
 *
 * Pure module state: no React, no store access.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types/mission";
import { randomId } from "@/lib/utils";

let clipboard: readonly Waypoint[] = [];

/** Copy a waypoint and its actions; every action gets a fresh id. */
function cloneWaypoint(wp: Waypoint): Waypoint {
  return wp.actions
    ? { ...wp, actions: wp.actions.map((a) => ({ ...a, id: randomId() })) }
    : { ...wp };
}

/** Replace the clipboard with a private copy of the given waypoints. */
export function setClipboard(waypoints: readonly Waypoint[]): void {
  clipboard = waypoints.map(cloneWaypoint);
}

/** Return a fresh copy of the clipboard contents (empty when nothing copied). */
export function getClipboard(): Waypoint[] {
  return clipboard.map(cloneWaypoint);
}

/** True when the clipboard holds at least one waypoint. */
export function hasClipboard(): boolean {
  return clipboard.length > 0;
}

/** Empty the clipboard. */
export function clearClipboard(): void {
  clipboard = [];
}
