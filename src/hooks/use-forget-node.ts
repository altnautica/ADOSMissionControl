"use client";

/**
 * @module hooks/use-forget-node
 * @description The ONE hook every unpair / remove / forget control goes
 * through. It owns the Convex `unpairDrone` mutation handle and the
 * availability gate, so no surface can skip the durable cloud-row delete.
 *
 * `forgetNode` itself documents why that delete matters: a cloud-paired node
 * re-feeds from the reactive `listMyDrones` query until its Convex row is
 * gone, so a call site that passes `unpairMutation: null` removes the node
 * for about one second and then watches it reappear, still paired. Two of the
 * three unpair surfaces shipped exactly that. Threading the mutation is a
 * component concern (only a component can hold a `useMutation` handle), and
 * this hook is that concern done once.
 *
 * @license GPL-3.0-only
 */

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { cmdDronesApi } from "@/lib/community-api-drones";
import { forgetNode, type UnpairDroneMutation } from "@/lib/agent/forget-node";

export interface UseForgetNodeOptions {
  /** Convex doc id for the cloud row, when this node is cloud-paired. */
  convexId?: string | null;
}

/**
 * Returns the forget action with the Convex delete already wired: callers
 * hand over the node id (and its Convex doc id when cloud-paired) and every
 * presence source — including the cloud row — is cleared.
 */
export function useForgetNode(): (
  nodeId: string,
  options?: UseForgetNodeOptions,
) => void {
  // A ConvexProvider is always mounted (local-only uses a non-resolving
  // client), so useMutation never throws; the handle is only INVOKED when
  // Convex is actually available.
  const convexAvailable = useConvexAvailable();
  const unpairDroneMutation = useMutation(cmdDronesApi.unpairDrone);

  return useCallback(
    (nodeId, options = {}) => {
      forgetNode(nodeId, {
        convexId: options.convexId ?? null,
        unpairMutation: convexAvailable
          ? (unpairDroneMutation as UnpairDroneMutation)
          : null,
      });
    },
    [convexAvailable, unpairDroneMutation],
  );
}
