"use client";

/**
 * @module hooks/use-node-last-seen
 * @description When one node was last heard from, judged by that node alone:
 * the freshest of its presence heartbeat, its FC heartbeat and its status row.
 * A node page reads this instead of the attached agent connection's clock,
 * which describes whichever node happens to be attached.
 * @license GPL-3.0-only
 */

import { useNodeRegistryStore } from "@/stores/node-registry";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { useClockTick } from "@/lib/agent/freshness";

/**
 * @param nodeDeviceId The bare device id of the node.
 * @returns The newest heard-from timestamp, or null when the node was never
 *   heard from. Re-renders every second so callers can age it on the clock.
 */
export function useNodeLastSeen(nodeDeviceId: string | null): number | null {
  const node = useNodeRegistryStore((s) =>
    nodeDeviceId ? s.nodes[nodeIdForDevice(nodeDeviceId)] : undefined,
  );
  const statusAt = useCommandFleetStore((s) =>
    nodeDeviceId ? (s.cloudStatuses[nodeDeviceId]?.updatedAt ?? 0) : 0,
  );
  useClockTick();
  const lastSeen = Math.max(
    node?.presence.lastHeartbeat ?? 0,
    node?.fc.lastHeartbeat ?? 0,
    statusAt,
  );
  return lastSeen > 0 ? lastSeen : null;
}
