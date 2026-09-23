/**
 * The one identity a plugin handler set is bound to.
 *
 * Plugin hosts mount against the fleet selection id (`node:<deviceId>` for an
 * agent node, `fc:<id>` for a direct flight controller). Two stores key on
 * that node id (`useDroneManager`, `useNodeRegistryStore`, the vision
 * detections store); everything that reaches the drone's agent (the LAN agent
 * resolver, the plugin config writer, capability-token `agentId` claims) keys
 * on the bare agent device id. Handlers take this pair, resolved once, and
 * pick the right half for each lookup, so no handler converts ids by hand.
 *
 * @module plugins/handlers/target
 * @license GPL-3.0-only
 */

import { deviceIdFromNodeId, nodeIdForDevice } from "@/lib/agent/node-id";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore, type NodeArmState } from "@/stores/node-registry";

export interface PluginTarget {
  /** Fleet selection id: the drone-manager / node-registry key. */
  nodeId: string;
  /**
   * Agent device id for agent reach (LAN agent, config writes, token
   * `agentId`). Equal to `nodeId` for a direct FC with no agent identity.
   */
  deviceId: string;
}

/**
 * Resolve the handler target from the id the host mounted against: a
 * `node:<deviceId>` selection id, an `fc:<id>` direct-FC id, or a bare agent
 * device id (all name one drone).
 */
export function resolvePluginTarget(id: string | null): PluginTarget | null {
  if (!id) return null;
  const fromNode = deviceIdFromNodeId(id);
  if (fromNode) return { nodeId: id, deviceId: fromNode };
  if (id.startsWith("fc:")) return { nodeId: id, deviceId: id };
  return { nodeId: nodeIdForDevice(id), deviceId: id };
}

/** The vehicle facts a safety gate compares before and after an operator wait. */
export interface TargetVehicleSnapshot {
  armState: NodeArmState | undefined;
  fcConnected: boolean;
  managedId: string | null;
}

/** Read the target's arm / link state from the node registry. */
export function readTargetVehicle(target: PluginTarget): TargetVehicleSnapshot {
  const entry = useNodeRegistryStore.getState().getEntry(target.nodeId);
  return {
    armState: entry?.fc.armState,
    fcConnected: entry?.connection.fcConnected ?? false,
    managedId: entry?.fc.managedId ?? null,
  };
}

/** Operator-facing name for the target drone, for confirmation copy. */
export function targetDisplayName(target: PluginTarget): string {
  const managed = useDroneManager.getState().drones.get(target.nodeId);
  if (managed?.name) return managed.name;
  const presence = useNodeRegistryStore.getState().getEntry(target.nodeId)?.presence;
  return presence?.name ?? target.deviceId;
}
