/**
 * How much a fleet node's flight-controller readings are worth right now, and
 * if nothing, why. One derivation shared by the board's cells and the per-node
 * skill context, so a row that renders "FC not reachable" never sits beside an
 * arm control that believes the vehicle's last reported state.
 *
 * An agent keeps heartbeating after its FC is unplugged or its serial link
 * dies, and its published vehicle state keeps the last values. So a reading is
 * narrower than the agent's liveness: a ground station or workstation flies
 * nothing, an offline node has no reading, and a live node whose agent reports
 * no reachable FC has an agent reading but no flight-controller one.
 *
 * @module nodes/fc-reading
 * @license GPL-3.0-only
 */

import { isFcReachable } from "@/lib/agent/mavlink-link";
import { nodeLiveness, type CommandAgentLiveness, type NodePresence } from "./presence";
import type { CommandCloudStatus } from "@/stores/command-fleet-store";

/** How much a node's last-pushed reading is worth right now. */
export type ReadingFreshness = "fresh" | "stale" | "none";

/** A reading is only fresh while the node is live; an offline node has none. */
export function readingFreshness(
  liveness: CommandAgentLiveness,
): ReadingFreshness {
  if (liveness === "live") return "fresh";
  if (liveness === "stale") return "stale";
  return "none";
}

/** How much a row's flight-controller readings are worth, and if nothing, why. */
export interface FcReading {
  freshness: ReadingFreshness;
  /** `nodesView` key naming why there is nothing to show; null when there is. */
  absentKey: "noLiveReading" | "fc.notReachable" | "fc.notFlightNode" | null;
}

/** The node facts an FC reading is judged from. A board summary fits. */
export interface FcReadingInput {
  liveness: CommandAgentLiveness;
  profile: "drone" | "ground-station" | "workstation";
  system: { fcReachable: boolean };
}

/** Resolve a node's FC reading from its liveness, profile and FC reachability. */
export function fcReading(summary: FcReadingInput): FcReading {
  if (summary.profile !== "drone") {
    return { freshness: "none", absentKey: "fc.notFlightNode" };
  }
  const freshness = readingFreshness(summary.liveness);
  if (freshness === "none") return { freshness, absentKey: "noLiveReading" };
  if (!summary.system.fcReachable) {
    return { freshness: "none", absentKey: "fc.notReachable" };
  }
  return { freshness, absentKey: null };
}

/** The membership fields a node's FC reachability is judged from. */
export interface FcNode extends NodePresence {
  profile?: FcReadingInput["profile"] | null;
  fcConnected?: boolean;
}

/**
 * Whether the node's agent reports a reachable flight controller. The per-node
 * status wins over the membership row's copy. A reachable MSP FC
 * (Betaflight/iNav) never sets fcConnected — it sends no MAVLink heartbeat —
 * but it is a connected, drivable FC, so the MSP variant/transport signal
 * counts too.
 */
export function nodeFcReachable(
  node: Pick<FcNode, "fcConnected">,
  status: CommandCloudStatus | undefined,
): boolean {
  return isFcReachable({
    fcConnected: status?.fcConnected ?? node.fcConnected,
    fcVariant: status?.fcVariant,
    transportOpen: status?.transportOpen,
    fcReachable: status?.fcReachable,
  });
}

/** The FC reading for a fleet node straight from its membership and status. */
export function nodeFcReading(
  node: FcNode,
  status: CommandCloudStatus | undefined,
): FcReading {
  return fcReading({
    liveness: nodeLiveness(node, status),
    profile: node.profile ?? "drone",
    system: { fcReachable: nodeFcReachable(node, status) },
  });
}
