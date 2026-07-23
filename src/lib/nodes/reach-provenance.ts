"use client";

/**
 * @module nodes/reach-provenance
 * @description Resolve the human name of a node referenced only by its device
 * id (or `node:<deviceId>` id) — used by the transitive-reach provenance UX to
 * name the ground node a drone is "linked via WFB through", and to name the
 * drone a ground node is relaying. The name matches what the node's own row
 * shows: a personalization label if the operator set one, else the paired /
 * LAN name. Returns null when the node is not (or no longer) known, so a
 * surface renders an honest fallback rather than a stale name (Rule 44).
 *
 * @license GPL-3.0-only
 */

import { usePairingStore, type PairedDrone } from "@/stores/pairing-store";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import {
  useNodePersonalizationStore,
  type NodePersonalization,
} from "@/stores/node-personalization-store";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";

/** Pure resolver: the display name for a device id across the paired / LAN
 * stores, preferring a personalization label. Null when unknown. */
export function resolveNodeDisplayName(
  deviceId: string | null,
  sources: {
    paired: readonly PairedDrone[];
    local: readonly LocalNode[];
    personalization: NodePersonalization | undefined;
  },
): string | null {
  if (!deviceId) return null;
  const label = sources.personalization?.label?.trim();
  if (label) return label;
  const paired = sources.paired.find((d) => d.deviceId === deviceId);
  if (paired?.name) return paired.name;
  const local = sources.local.find((n) => n.deviceId === deviceId);
  if (local?.name) return local.name;
  return null;
}

/** The display name of a node by device id, or null when unknown. */
export function useNodeDisplayName(deviceId: string | null): string | null {
  const paired = usePairingStore((s) => s.pairedDrones);
  const local = useLocalNodesStore((s) => s.nodes);
  const personalization = useNodePersonalizationStore((s) =>
    deviceId ? s.byNode[deviceId] : undefined,
  );
  return resolveNodeDisplayName(deviceId, { paired, local, personalization });
}

/** The display name of the ground node a drone is reached through, resolved
 * from its `node:<deviceId>` reach hop. Null when the hop is absent / unknown. */
export function useReachedViaName(
  reachedVia: string | undefined,
): string | null {
  return useNodeDisplayName(reachedVia ? deviceIdFromNodeId(reachedVia) : null);
}
