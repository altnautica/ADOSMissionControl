/**
 * @module AgentConnectionPollBackoff
 * @description Pure poll-cadence math for the agent connection client. Kept in
 * its own store-free module so it can be imported (and unit-tested) without
 * pulling in the full agent-connection store graph, whose aggregator builds the
 * Zustand store at import time — importing the client-manager slice directly
 * would otherwise trip a load-order cycle.
 * @license GPL-3.0-only
 */

/** Base poll cadence for a healthy/reachable agent on the LAN. */
export const POLL_BASE_MS = 3000;
/** Base poll cadence for an agent reached over a radio relay. The drone's
 * radio is half-duplex and already spends most of its airtime injecting
 * video, so every uplink poll competes with the payload it exists to carry.
 * One consolidated round trip per 10 s instead of the LAN cadence keeps the
 * control lane responsive without starving the video it shares. */
export const POLL_BASE_RELAY_MS = 10_000;
/** Failure count past which the agent is declared offline and the loop moves
 * to its fixed recovery retry. Matches the offline threshold in the staleness
 * cascade (`noteFetchFailure`), so the retry cadence switches exactly when the
 * header flips offline. */
export const OFFLINE_FAILURE_THRESHOLD = 6;
/** Bounds of the fixed recovery retry once the agent is offline. A recovery
 * loop retries forever at a fixed 2-5 s: never faster (a dead host is not
 * hammered at a sub-second cadence), and never slower (a node that comes back
 * is seen within seconds, not after a long backoff). */
export const OFFLINE_RETRY_MIN_MS = 2000;
export const OFFLINE_RETRY_MAX_MS = 5000;

/** Reschedule delay derived from the consecutive-failure count. Stays at the
 * caller's base cadence until the agent is declared offline, then retries at
 * the base clamped into the fixed recovery window: 3 s on the LAN, 5 s over
 * the relay. The first `noteFetchSuccess` resets `consecutiveFailures` to 0,
 * which snaps this straight back to the base.
 *
 * `baseMs` is a parameter rather than the fixed `POLL_BASE_MS` because a
 * relayed agent polls slower (`POLL_BASE_RELAY_MS`). */
export function nextPollDelay(
  consecutiveFailures: number,
  baseMs: number = POLL_BASE_MS,
): number {
  if (consecutiveFailures < OFFLINE_FAILURE_THRESHOLD) return baseMs;
  return Math.min(Math.max(baseMs, OFFLINE_RETRY_MIN_MS), OFFLINE_RETRY_MAX_MS);
}
