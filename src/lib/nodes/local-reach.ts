/**
 * @module nodes/local-reach
 * @description Which LAN address a locally-paired node is actually reached at,
 * and what happened the last time the GCS tried.
 *
 * A node paired over the LAN carries up to three candidate reaches — the base
 * URL the operator typed (`hostname`), the mDNS name the agent reports for
 * itself (`mdnsHost`), and the IPv4 the server-side proxy resolved at pair
 * time (`ipv4`) — and different consumers pick different ones. Nothing
 * recorded which one answered, so when a node greyed out the three distinct
 * causes (the agent is powered off; the `.local` name stopped resolving; the
 * DHCP lease moved) were indistinguishable and produced the same tile.
 *
 * This module owns the vocabulary for that record: the failure buckets the
 * browser can actually PROVE, the display form of a reach, and the alternative
 * address worth offering. Sibling to `reach-provenance`, which answers the
 * different question of which ground node a RELAYED drone is reached through.
 *
 * @license GPL-3.0-only
 */

import { PairClientError } from "@/lib/agent/local-pair/errors";

/**
 * What the GCS can honestly say about a failed reach.
 *
 * Deliberately coarse. Through Mission Control's server-side proxy a DNS
 * failure, a refused connection and a powered-off board are one identical 502,
 * so a finer bucket ("the name did not resolve") would be a fabricated
 * diagnosis. What the operator needs instead is the distinction the transport
 * genuinely provides — did anything answer at all? — plus a one-click way to
 * try the other address.
 *
 *  - `no-answer`      — nothing answered at that address.
 *  - `refused`        — the node answered and declined (4xx). It is up.
 *  - `not-ready`      — the node answered but is still starting (503) or did
 *                       not finish in time (408/504). It is up.
 *  - `fault`          — the node answered with an internal fault (5xx). It is up.
 *  - `proxy-refused`  — Mission Control's own proxy declined to contact the
 *                       address (not on the local network). The node was never
 *                       asked, so nothing is known about it.
 *  - `unknown`        — the attempt failed in a way this code cannot classify.
 */
export type ReachErrorBucket =
  | "no-answer"
  | "refused"
  | "not-ready"
  | "fault"
  | "proxy-refused"
  | "unknown";

export const REACH_ERROR_BUCKETS: readonly ReachErrorBucket[] = [
  "no-answer",
  "refused",
  "not-ready",
  "fault",
  "proxy-refused",
  "unknown",
];

/**
 * Whether switching to another address is a plausible recovery. Only when the
 * stored address produced no answer (or the proxy would not try it) could a
 * different address help; a node that answered is reachable where it is.
 */
export function bucketSuggestsOtherAddress(bucket: ReachErrorBucket): boolean {
  return bucket === "no-answer" || bucket === "proxy-refused" || bucket === "unknown";
}

/** Which bucket each pair-flow failure code lands in. A code absent from this
 * table classifies as `unknown` rather than being guessed at. */
const BUCKET_BY_PAIR_CODE: Record<string, ReachErrorBucket> = {
  pairKeyRejectedError: "refused",
  pairPinRequiredError: "refused",
  pairRouteMissingError: "refused",
  pairRefusedError: "refused",
  hostNotPrivateError: "proxy-refused",
  pairAgentFaultError: "fault",
  pairUnreachableError: "no-answer",
  pairHostedRemotelyError: "no-answer",
  pairTimedOutError: "not-ready",
  pairAgentNotReadyError: "not-ready",
};

/** Classify a thrown probe failure into the coarsest bucket that is true. */
export function reachErrorBucket(error: unknown): ReachErrorBucket {
  if (error instanceof PairClientError) {
    return BUCKET_BY_PAIR_CODE[error.code] ?? "unknown";
  }
  // A bare fetch rejection (only reachable off the pair-flow paths) is a
  // transport failure, which is the same observable as nothing answering.
  if (error instanceof TypeError) return "no-answer";
  return "unknown";
}

/**
 * The address inside a stored reach, as the operator would recognise it: no
 * scheme, and no port unless it is one they had to choose. `hostname` on a
 * `LocalNode` is a full base URL (`http://testnode.local:8080`), which is not
 * what belongs in a sentence.
 */
export function reachDisplayHost(reach: string): string {
  try {
    const u = new URL(reach);
    return u.port === "8080" || u.port === ""
      ? u.hostname
      : `${u.hostname}:${u.port}`;
  } catch {
    return reach.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  }
}

/**
 * The alternative address worth offering when the stored reach stops
 * answering, or null when there is no distinct one. A node paired by name
 * carries the proxy-resolved IPv4 as well, and switching onto it is the whole
 * recovery for both a name that stopped resolving and a renumbered box — the
 * two causes the transport cannot tell apart.
 */
export function alternateReach(node: {
  hostname: string;
  ipv4?: string;
  lastReachOk?: { host: string };
}): string | null {
  const current = reachDisplayHost(node.hostname);
  for (const candidate of [node.ipv4, node.lastReachOk?.host]) {
    if (!candidate) continue;
    if (reachDisplayHost(candidate) !== current) return candidate;
  }
  return null;
}
