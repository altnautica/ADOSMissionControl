/**
 * @module cockpit/immersive-request
 * @description "Open cockpit" from outside the cockpit: switch the node detail
 * to its Cockpit tab and go immersive once that tab is actually showing.
 * Entering immersive in the same tick as the tab request would be undone at
 * once, because immersive mode is only allowed while the cockpit is the
 * visible surface; so the request is parked here and the cockpit honours it
 * when it mounts (or at once, when it is already mounted).
 * @license GPL-3.0-only
 */

let pending = false;
const listeners = new Set<() => void>();

/** Ask the cockpit to enter immersive mode as soon as it is showing. */
export function requestImmersiveCockpit(): void {
  pending = true;
  for (const listener of listeners) listener();
}

/** Take the parked request, if any. */
export function consumeImmersiveRequest(): boolean {
  const had = pending;
  pending = false;
  return had;
}

/** Listen for requests made while a cockpit is mounted. */
export function onImmersiveRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
