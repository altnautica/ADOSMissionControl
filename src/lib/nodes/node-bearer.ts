/**
 * Which bearer(s) carry a fleet node to the GCS, and how verified each one is.
 *
 * The command reach (LAN / cloud / direct-FC / none) answers "if I press
 * something, what carries it?". The bearer answers a different, physical
 * question: over which link is this node actually reached or seen? A drone the
 * GCS never paired with still appears because a ground node relays it over WFB —
 * its command reach is "none" today, but its bearer is the radio, and the board
 * has to say so rather than call it unreachable.
 *
 * A node can be carried by more than one bearer at once: a drone paired directly
 * over the LAN that a ground node also relays over WFB shows the direct path as
 * primary and the radio path as a secondary provenance chip. So this resolves a
 * primary bearer and an optional secondary.
 *
 * Verification follows the same discipline as every other reading on this board
 * (Rule 44 / Rule 37): a WFB bearer counts as verified only when the far side
 * heard a frame from it (a received-side signal, surfaced as the peer RSSI). No
 * signal is "unverified", not a confident green; a node that has gone dark is
 * "down"; a last-known reading on a stale node is "stale". A LAN or cloud bearer
 * carries no RF reading — it is a reachability capability, verified when the lane
 * resolves — so it is never dressed up with a signal it does not have.
 *
 * @module nodes/node-bearer
 * @license GPL-3.0-only
 */

import type { NodeReachKind } from "@/lib/nodes/node-reach";
import type { CommandAgentLiveness } from "@/lib/nodes/presence";

/** The physical / logical link a node is reached or seen over. */
export type NodeBearerKind = "lan" | "wfb" | "cloud" | "direct-fc" | "none";

/**
 * How trustworthy a bearer's reading is right now. Only a WFB bearer moves
 * through all four: a LAN / cloud lane is a capability that either resolves
 * ("verified") or does not ("down"), with no RF state in between.
 */
export type BearerVerification = "verified" | "unverified" | "stale" | "down";

/** One bearer's presentation model. */
export interface NodeBearerChip {
  kind: NodeBearerKind;
  /** For a WFB bearer, the ground node's display name; null when unknown. */
  viaName: string | null;
  verification: BearerVerification;
  /** The received-side signal in dBm when the bearer reports one; null otherwise. */
  rssiDbm: number | null;
}

/** A node's bearers: how it is primarily reached, plus an optional alternate. */
export interface NodeBearers {
  primary: NodeBearerChip;
  /** An alternate path the node is also carried over (e.g. WFB provenance on a
   * directly-paired drone). Null when there is only one path. */
  secondary: NodeBearerChip | null;
}

export interface DeriveNodeBearersInput {
  /** The command-reach kind (LAN / cloud / direct-fc / none). */
  reachKind: NodeReachKind;
  /** True when the node is enrolled solely through a WFB relay. */
  isRelayed: boolean;
  /** True when a directly-reached node ALSO carries WFB relay provenance. */
  hasReachedVia: boolean;
  /** The resolved name of the ground node the WFB path runs through, or null. */
  reachedViaName: string | null;
  /** The peer RSSI (dBm) the ground node heard this drone at; null when unknown. */
  wfbRssiDbm: number | null;
  /** The node's liveness, so a WFB verdict dims / falls to "down" honestly. */
  liveness: CommandAgentLiveness;
}

/**
 * Classify a WFB bearer's reading. Verified needs a received-side signal AND a
 * live node; no signal is unverified; a dark node is down; a signal on a stale
 * node is stale. Never a confident verdict without a heard frame (Rule 37/44).
 */
function verifyWfb(
  rssiDbm: number | null,
  liveness: CommandAgentLiveness,
): BearerVerification {
  if (liveness === "offline") return "down";
  if (rssiDbm == null) return "unverified";
  if (liveness === "stale") return "stale";
  return "verified";
}

function wfbChip(
  reachedViaName: string | null,
  rssiDbm: number | null,
  liveness: CommandAgentLiveness,
): NodeBearerChip {
  return {
    kind: "wfb",
    viaName: reachedViaName,
    verification: verifyWfb(rssiDbm, liveness),
    rssiDbm,
  };
}

/**
 * Resolve a node's bearer chips from its command reach and its relay provenance.
 * Pure, so the presentation and the truth it renders can be proven without a tree.
 */
export function deriveNodeBearers(input: DeriveNodeBearersInput): NodeBearers {
  const {
    reachKind,
    isRelayed,
    hasReachedVia,
    reachedViaName,
    wfbRssiDbm,
    liveness,
  } = input;

  // A relayed-only drone: the radio IS its reach, so WFB is the primary chip and
  // there is no other path to note.
  if (isRelayed) {
    return {
      primary: wfbChip(reachedViaName, wfbRssiDbm, liveness),
      secondary: null,
    };
  }

  // A directly-connected FC is plugged into this browser — no bearer beyond that.
  if (reachKind === "direct-fc") {
    return {
      primary: { kind: "direct-fc", viaName: null, verification: "verified", rssiDbm: null },
      secondary: null,
    };
  }

  const primaryKind: NodeBearerKind =
    reachKind === "lan" ? "lan" : reachKind === "cloud" ? "cloud" : "none";
  const primary: NodeBearerChip = {
    kind: primaryKind,
    viaName: null,
    // LAN / cloud reachability is a capability, not an RF reading: verified when
    // the lane resolves, down when nothing does.
    verification: primaryKind === "none" ? "down" : "verified",
    rssiDbm: null,
  };

  // A directly-reached node that a ground node also relays keeps the WFB path as
  // a secondary provenance chip. Its signal lives on the ground node's own row,
  // not here, so this chip carries no RSSI and reads unverified — never a
  // confident green from a link this row cannot independently prove (Rule 44).
  const secondary =
    hasReachedVia && liveness !== "offline"
      ? wfbChip(reachedViaName, null, liveness)
      : null;

  return { primary, secondary };
}
