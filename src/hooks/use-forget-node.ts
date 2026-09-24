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
import { useTranslations } from "next-intl";
import { useConvexAvailable } from "@/hooks/use-convex-available";
import { useToast } from "@/components/ui/toast";
import { cmdDronesApi } from "@/lib/community-api-drones";
import {
  forgetNode,
  type ForgetNodeResult,
  type UnpairDroneMutation,
} from "@/lib/agent/forget-node";

export interface UseForgetNodeOptions {
  /** Convex doc id for the cloud row, when this node is cloud-paired. */
  convexId?: string | null;
}

/**
 * Returns the forget action with the Convex delete already wired: callers
 * hand over the node id (and its Convex doc id when cloud-paired) and every
 * presence source — including the cloud row — is cleared. A cloud row that
 * could not be removed leaves the node paired; this hook reports that as an
 * error toast, and the resolved result lets a caller confirm success.
 */
export function useForgetNode(): (
  nodeId: string,
  options?: UseForgetNodeOptions,
) => Promise<ForgetNodeResult> {
  // A ConvexProvider is always mounted (local-only uses a non-resolving
  // client), so useMutation never throws; the handle is only INVOKED when
  // Convex is actually available.
  const convexAvailable = useConvexAvailable();
  const unpairDroneMutation = useMutation(cmdDronesApi.unpairDrone);
  const t = useTranslations("dronePanel");
  const { toast } = useToast();

  return useCallback(
    async (nodeId, options = {}) => {
      const result = await forgetNode(nodeId, {
        convexId: options.convexId ?? null,
        unpairMutation: convexAvailable
          ? (unpairDroneMutation as UnpairDroneMutation)
          : null,
      });
      if (!result.ok) {
        toast(
          result.reason === "cloudUnavailable"
            ? t("forgetCloudUnavailable")
            : t("forgetCloudFailed", { error: result.message }),
          "error",
        );
      }
      return result;
    },
    [convexAvailable, unpairDroneMutation, t, toast],
  );
}
