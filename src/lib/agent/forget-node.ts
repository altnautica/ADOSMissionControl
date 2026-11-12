/**
 * @module agent/forget-node
 * @description The ONE atomic "forget a node" action every remove / unpair /
 * delete surface routes through. A node can be present via several sources at
 * once — a managed FC, a live agent connection, a Convex cloud row, a LAN
 * `local-nodes-store` credential, and a node-registry presence entry — and a
 * removal that only clears some of them lets the others resurrect the card:
 *
 *   1. The fleet list is derived from the node registry on read, so a node
 *      is gone from it only once every registry presence source is dropped
 *      (step 5).
 *   2. A cloud-paired drone re-feeds from the reactive Convex `listMyDrones`
 *      query (`CloudDroneBridge` + `useFleetSync`) until the Convex row is
 *      deleted. The panel delete used to miss this for cloud-only drones (it
 *      gated the durable removal on a `local-nodes-store` entry the cloud drone
 *      doesn't have), so the row came back instantly.
 *
 * `forgetNode` removes the cloud row FIRST and only then clears every local
 * source, in the right order so the registry row GCs immediately and nothing
 * re-adds it. A cloud row that cannot be removed (mutation failed, or Convex
 * unreachable) aborts the forget with the node left exactly as it was: a
 * locally-forgotten node whose cloud row survives re-feeds from
 * `listMyDrones` and reappears, still paired, so reporting it removed would
 * be false. The local steps:
 *   - drop the pairing-store row;
 *   - disconnect the live agent connection if it is this node (cancels polling);
 *   - intentionally remove any managed FC under this node id (so the
 *     unexpected-disconnect → auto-reconnect path does NOT fire);
 *   - release the agent's LAN pairing + forget the local credential;
 *   - drop both registry presence sources + the command-fleet status row so the
 *     projection re-run finds nothing.
 *
 * @license GPL-3.0-only
 */

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useReconnectStore } from "@/stores/reconnect-store";
import { useDroneMetadataStore } from "@/stores/drone-metadata-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { unpairLocal } from "@/lib/agent/local-pair-client";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";

/**
 * The Convex `unpairDrone` mutation, threaded in by `useForgetNode` (the one
 * hook that holds the `useMutation` handle — components call the hook, never
 * this module directly, so no surface can skip the cloud-row delete). Null
 * when Convex is unavailable. Typed loosely (`droneId: never`) to match the
 * generated mutation reference.
 */
export type UnpairDroneMutation =
  | ((args: { droneId: never }) => Promise<unknown>)
  | null
  | undefined;

export interface ForgetNodeOptions {
  /** Convex doc id for the cloud row, when this node is cloud-paired. The
   * pairing-store row + the `unpairDrone` mutation both key on it. */
  convexId?: string | null;
  /** The Convex unpair mutation handle from the calling component. */
  unpairMutation?: UnpairDroneMutation;
  /** Forget on this GCS only: skip releasing the pairing on the node itself.
   * The operator chooses this after the node could not be reached. */
  localOnly?: boolean;
}

/** The outcome of a forget. `cloudUnavailable`: the node is cloud-paired and
 * Convex is not reachable; `cloudFailed`: the unpair mutation was rejected;
 * `agentUnreachable`: the node could not release its LAN pairing. In every
 * failure no local source was cleared. */
export type ForgetNodeResult =
  | { ok: true }
  | { ok: false; reason: "cloudUnavailable" }
  | { ok: false; reason: "cloudFailed"; message: string }
  | { ok: false; reason: "agentUnreachable"; message: string };

/**
 * Forget the node identified by the canonical `node:<deviceId>` id across every
 * store + the agent + Convex. Idempotent: a missing source is a no-op. A node
 * that cannot release its LAN pairing stops the forget (`agentUnreachable`)
 * unless the caller passes `localOnly`. Resolves once the cloud row is gone
 * and the local stores are cleared, or with the reason nothing was cleared.
 */
export async function forgetNode(
  nodeId: string,
  options: ForgetNodeOptions = {},
): Promise<ForgetNodeResult> {
  const deviceId = deviceIdFromNodeId(nodeId);

  // 0. LAN: ask the node to release its pairing before anything is
  // cleared. Forgetting the credential while the node still holds the pairing
  // left the node paired to a GCS that no longer knows it, and the failure
  // was silent. The caller offers "forget on this GCS only" on failure.
  const localNode = deviceId
    ? useLocalNodesStore.getState().nodes.find((n) => n.deviceId === deviceId)
    : undefined;
  if (localNode && !options.localOnly) {
    try {
      await unpairLocal(localNode.hostname, localNode.apiKey);
    } catch (err) {
      return {
        ok: false,
        reason: "agentUnreachable",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // 1. Cloud: delete the Convex row first, so the reactive `listMyDrones`
  // query stops returning it (otherwise CloudDroneBridge + useFleetSync re-add
  // it instantly), then drop the pairing-store row (keyed on the Convex doc
  // id). A failure leaves every source untouched.
  const convexId = options.convexId ?? null;
  if (convexId) {
    if (!options.unpairMutation) return { ok: false, reason: "cloudUnavailable" };
    try {
      await options.unpairMutation({ droneId: convexId as never });
    } catch (err) {
      return {
        ok: false,
        reason: "cloudFailed",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    usePairingStore.getState().removePairedDrone(convexId);
  }

  // 2. Disconnect the live agent connection if it is focused on this node, so
  // the poll loop stops and the agent stores reset. `nodeDeviceId` is the
  // device id the active connection was opened under (local or cloud).
  const conn = useAgentConnectionStore.getState();
  if (deviceId && conn.nodeDeviceId === deviceId) {
    conn.disconnect();
  }

  // 3. Stop any reconnect cycle for this node, then intentionally remove any
  // managed FC under it. The cancel is unconditional: between attempts the
  // drone is not in the manager, but its cycle would re-add it. The FC id IS
  // the node id for an agent-attached FC (`node:<deviceId>`).
  useReconnectStore.getState().cancel(nodeId);
  const mgr = useDroneManager.getState();
  if (mgr.drones.has(nodeId)) {
    mgr.disconnectDrone(nodeId);
  }

  // Forget any per-node display metadata (name override, etc.).
  useDroneMetadataStore.getState().deleteProfile(nodeId);

  // 4. LAN: forget the local credential (the node released it above, or the
  // operator chose to forget on this GCS only).
  if (deviceId && localNode) {
    useLocalNodesStore.getState().removeNode(deviceId);
  }

  // 5. Registry: drop BOTH presence sources + the command-fleet status row NOW,
  // so the fleet projection finds nothing and the card does not
  // flash back. dropPresence GCs the registry entry once it has no presence
  // source and no attached FC (already detached in step 3).
  const registry = useNodeRegistryStore.getState();
  registry.dropPresence(nodeId, "local");
  registry.dropPresence(nodeId, "cloud");
  if (deviceId) {
    const fleet = useCommandFleetStore.getState();
    fleet.removeCloudStatuses([deviceId]);
    fleet.clearTelemetry([deviceId]);
  }
  return { ok: true };
}
