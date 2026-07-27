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
/** Failure count past which the loop stops hammering at the base cadence and
 * begins backing off. Matches the offline threshold in the staleness cascade
 * (`noteFetchFailure`), so backoff begins exactly when the header flips
 * offline. */
export const OFFLINE_FAILURE_THRESHOLD = 6;
/** Backoff ceiling once the agent is declared offline. */
export const POLL_MAX_MS = 30000;

/** Reschedule delay derived from the consecutive-failure count. Stays at the
 * caller's base cadence until the agent is declared offline, then ramps
 * geometrically toward the ceiling so a dead host is not hammered. A small
 * jitter avoids synchronised retries across tabs/agents. The first
 * `noteFetchSuccess` resets `consecutiveFailures` to 0, which snaps this
 * straight back to the base.
 *
 * `baseMs` is a parameter rather than the fixed `POLL_BASE_MS` because a
 * relayed agent polls an order of magnitude slower (`POLL_BASE_RELAY_MS`);
 * the backoff shape is identical, only its unit differs. */
export function nextPollDelay(
  consecutiveFailures: number,
  baseMs: number = POLL_BASE_MS,
): number {
  if (consecutiveFailures < OFFLINE_FAILURE_THRESHOLD) return baseMs;
  // 0 extra steps → 2x base, then 4x, 8x … capped at POLL_MAX_MS.
  const steps = consecutiveFailures - OFFLINE_FAILURE_THRESHOLD;
  const backoff = Math.min(baseMs * 2 ** (steps + 1), POLL_MAX_MS);
  const jitter = Math.floor(Math.random() * 1000);
  return backoff + jitter;
}
