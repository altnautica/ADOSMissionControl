"use client";

/**
 * @module command/nodes-view/use-mesh-inputs
 * @description Resolve the board rows into the reach inputs the mesh graph and
 * the relay-streams list both consume.
 *
 * The Reach column already resolves each row's command reach, its bearers
 * (primary + alternate), and the name of the ground node a relay runs through.
 * The graph needs the same three facts per node. Rather than re-derive them a
 * second way — which would let the map and the table drift — this hook resolves
 * them once, through the very same helpers the Reach column uses, and hands the
 * result to both the graph and the relay list. One source, so a node's edge and
 * its row can never disagree about its link (Rule 44).
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";

import type { NodeRowModel } from "@/lib/nodes/node-rows";
import type { NodeCommandSinkOptions } from "@/lib/nodes/command-sink";
import type { MeshNodeInput } from "@/lib/nodes/mesh-graph";
import { describeNodeReach } from "@/lib/nodes/node-reach";
import { deriveNodeBearers } from "@/lib/nodes/node-bearer";
import { resolveNodeDisplayName } from "@/lib/nodes/reach-provenance";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { usePairingStore } from "@/stores/pairing-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useNodePersonalizationStore } from "@/stores/node-personalization-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";

/** Resolve the mesh inputs for the given rows. Live off the same reach + bearer
 * helpers the Reach column reads, so the graph mirrors the table. */
export function useMeshInputs(
  rows: readonly NodeRowModel[],
  laneOptions: NodeCommandSinkOptions,
): MeshNodeInput[] {
  const paired = usePairingStore((s) => s.pairedDrones);
  const local = useLocalNodesStore((s) => s.nodes);
  const byNode = useNodePersonalizationStore((s) => s.byNode);
  const cloudStatuses = useCommandFleetStore((s) => s.cloudStatuses);

  return useMemo(
    () =>
      rows.map((row): MeshNodeInput => {
        const node = row.node;
        const reach = describeNodeReach(node, laneOptions);
        const reachedViaDeviceId = node.reachedVia
          ? deviceIdFromNodeId(node.reachedVia)
          : null;
        const reachedViaName = resolveNodeDisplayName(reachedViaDeviceId, {
          paired,
          local,
          personalization: reachedViaDeviceId
            ? byNode[reachedViaDeviceId]
            : undefined,
        });
        // The received-side signal the ground node heard this drone at rides its
        // funneled status row; a directly-paired drone carries none, so its
        // alternate WFB chip stays unverified by construction (Rule 44).
        const wfbRssiDbm = cloudStatuses[node.deviceId]?.peerRssiDbm ?? null;

        const { primary, secondary } = deriveNodeBearers({
          reachKind: reach.kind,
          isRelayed: node.isRelayed ?? false,
          hasReachedVia: !node.isRelayed && !!node.reachedVia,
          reachedViaName,
          wfbRssiDbm,
          liveness: row.summary.liveness,
        });

        return {
          id: node._id,
          name: node.name,
          profile: node.profile,
          liveness: row.summary.liveness,
          isRelayed: node.isRelayed ?? false,
          reachedViaId: node.reachedVia ?? null,
          primary,
          secondary,
        };
      }),
    [rows, laneOptions, paired, local, byNode, cloudStatuses],
  );
}
