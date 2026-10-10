/**
 * The FC link's state from its heartbeat age, shared by the safety band's
 * link readout, its live-region announcer, and the cockpit alert stack so the
 * three can never disagree about when the link went stale or was lost.
 *
 * @license GPL-3.0-only
 */

/** Heartbeat silence after which the link reads stale. */
export const LINK_STALE_MS = 3_000;
/** Heartbeat silence after which the link reads lost. */
export const LINK_LOST_MS = 10_000;

/** `none` = no heartbeat has ever been heard on this session. */
export type LinkState = "none" | "ok" | "stale" | "lost";

export function linkStateFromHeartbeat(lastHeartbeat: number, now: number = Date.now()): LinkState {
  if (!(lastHeartbeat > 0)) return "none";
  const age = now - lastHeartbeat;
  if (age > LINK_LOST_MS) return "lost";
  if (age > LINK_STALE_MS) return "stale";
  return "ok";
}
