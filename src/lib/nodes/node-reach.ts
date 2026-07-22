"use client";

/**
 * How the GCS reaches one fleet node, and whether it can actually command it.
 *
 * A board that offers inline flight controls has to answer this per row before
 * it renders anything: a control on a node no command can reach is worse than
 * no control at all, because it reads as available and does nothing. The reach
 * descriptor answers it once — which transport carries a command, whether the
 * result will be the vehicle's own acknowledgement or only a queue receipt, and
 * when nothing carries, which of the four causes it is.
 *
 * Reach is derived from the command sink rather than guessed from pairing
 * fields, so what the board shows and what a control actually does can never
 * disagree.
 *
 * A directly-connected flight controller is reachable for viewing (it is
 * plugged into this browser) but has no agent behind it, so it has no agent
 * command lane — its own kind rather than a blanket "unreachable", so the row
 * can say what it is and point at the node's own panel.
 *
 * @module nodes/node-reach
 * @license GPL-3.0-only
 */

import {
  resolveNodeCommandReach,
  type CommandTargetNode,
  type NodeCommandBlockedReason,
  type NodeCommandSink,
  type NodeCommandSinkOptions,
} from "@/lib/nodes/command-sink";

/**
 * How a node is reached. `lan` and `cloud` can carry commands; `direct-fc` is
 * connected to this browser but has no agent lane; `none` cannot be reached.
 */
export type NodeReachKind = "lan" | "cloud" | "direct-fc" | "none";

export interface NodeReachDescriptor {
  kind: NodeReachKind;
  /** True when a command can actually be carried to this node. */
  commandable: boolean;
  /**
   * True when a command's result is the vehicle's own acknowledgement. False on
   * a store-and-forward lane, where a result only means the command was
   * accepted for delivery.
   */
  reportsVehicleAck: boolean;
  /** Why no lane resolved. Present exactly when `commandable` is false. */
  blockedReason?: NodeCommandBlockedReason;
  /** The command surface, or null when nothing can carry a command. */
  sink: NodeCommandSink | null;
}

/** Describe how `node` is reached, and whether it can be commanded. */
export function describeNodeReach(
  node: CommandTargetNode,
  options: NodeCommandSinkOptions = {},
): NodeReachDescriptor {
  const reach = resolveNodeCommandReach(node, options);

  if (reach.sink) {
    return {
      kind: reach.sink.transport,
      commandable: true,
      reportsVehicleAck: reach.sink.reportsVehicleAck,
      sink: reach.sink,
    };
  }

  return {
    kind: reach.blockedReason === "direct-fc" ? "direct-fc" : "none",
    commandable: false,
    reportsVehicleAck: false,
    blockedReason: reach.blockedReason,
    sink: null,
  };
}
