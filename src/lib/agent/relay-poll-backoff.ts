/** Adaptive interval for the relay lane's detection poll.
 *
 * The relay poll is not a local HTTP call: every tick is a full request and
 * response over the radio's auxiliary lane, sharing that lane with telemetry,
 * status, identity and any relay-proxy call the operator makes. A fixed 4 Hz
 * poll spends that airtime whether or not anything is being tracked, and the
 * common case by far is that nothing is — vision may not be running at all.
 *
 * So the fast rate is earned rather than assumed: a poll that returns a fresh
 * batch resets to it, and a poll that returns nothing (or fails) steps the
 * interval out toward a ceiling. Click-to-track stays responsive because the
 * first fresh batch snaps the loop straight back to the base rate, while an
 * idle drone costs a fraction of the radio time it used to.
 */

/** Base interval: inside the follow-me plugin's own output-rate ceiling and
 *  above the floor a click-to-track loop stays usable at. */
export const RELAY_POLL_BASE_MS = 250;

/** Slowest the idle poll gets. Bounded so a drone that starts producing
 *  detections is noticed within about a second even at full backoff. */
export const RELAY_POLL_MAX_MS = 2000;

/** Growth per empty or failed poll. */
const BACKOFF_FACTOR = 1.6;

/** What a poll produced, for the purpose of pacing the next one. */
export type PollOutcome = "fresh" | "empty" | "error";

/** The next interval, given the current one and what the last poll produced.
 *
 * `fresh` resets to the base rate immediately — responsiveness matters more
 * than smoothing when a target is actually being tracked. Everything else
 * grows geometrically toward the ceiling.
 */
export function nextPollIntervalMs(currentMs: number, outcome: PollOutcome): number {
  if (outcome === "fresh") return RELAY_POLL_BASE_MS;
  const grown = Math.round(currentMs * BACKOFF_FACTOR);
  return Math.min(Math.max(grown, RELAY_POLL_BASE_MS), RELAY_POLL_MAX_MS);
}
