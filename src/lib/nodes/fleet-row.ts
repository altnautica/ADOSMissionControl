/**
 * @module nodes/fleet-row
 * @description Map a node reference to the fleet row that represents it. A
 * Dashboard grid tile, an MCP activity row and any other surface that names a
 * node by device id resolve it here, so "open this node" selects the same row
 * wherever it starts.
 * @license GPL-3.0-only
 */

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useFleetStore } from "@/stores/fleet-store";
import { nodeIdForDevice } from "@/lib/agent/node-id";

/**
 * Resolve a node reference to a selectable fleet-row id. Accepts a direct-FC
 * managed id (`fc:<random>`, already a row id), a canonical `node:<deviceId>`,
 * a bare agent device id, a cloud device id, or `local` for the agent this GCS
 * is attached to. Returns null when no fleet row matches.
 */
export function resolveFleetRowId(node: string): string | null {
  const target =
    node === "local" ? useAgentConnectionStore.getState().nodeDeviceId : node;
  if (!target) return null;
  const fleet = useFleetStore.getState().drones;
  if (fleet.some((d) => d.id === target)) return target;
  const nid = nodeIdForDevice(target);
  if (fleet.some((d) => d.id === nid)) return nid;
  const match = fleet.find((d) => d.cloudDeviceId === target);
  return match ? match.id : null;
}
