/**
 * Per-node presence and telemetry sourcing, shared by every surface that asks
 * what one fleet node is reporting and whether anything is still hearing from
 * it.
 *
 * Two maps carry a node's telemetry. The heartbeat row
 * (`cloudStatuses[deviceId].telemetry`) is filled by the LAN status poll; the
 * live stream (`telemetryByDeviceId`) is filled by the MQTT bridge for
 * cloud-paired nodes, whose heartbeat rows carry no telemetry at all. So a
 * consumer that reads only the heartbeat row sees nothing for exactly the
 * nodes the cloud lane exists to serve. `telemetryValue` is the single merge
 * rule — live stream first, heartbeat row as fallback — and both the display
 * cells and the command gates read through it, so the two can never disagree
 * about whether a node's flight state is known.
 *
 * Presence is the other half of the same honesty rule: a persisted telemetry
 * value is only worth anything while the node is still being heard from, so
 * `nodeLiveness` derives live/stale/offline from the newest heard-from
 * timestamp either presence source carries. The display cells and the command
 * gates both judge freshness through it, so a row whose readings have gone
 * dark can never keep enabled flight controls beside them.
 *
 * @module nodes/presence
 * @license GPL-3.0-only
 */

import {
  STALE_THRESHOLD_MS,
  OFFLINE_THRESHOLD_MS,
} from "@/lib/agent/freshness";
import type {
  CommandCloudStatus,
  CommandTelemetrySnapshot,
} from "@/stores/command-fleet-store";

/** How current a node's last contact is. */
export type CommandAgentLiveness = "live" | "stale" | "offline";

/** The membership fields presence is judged from. A fleet node entry fits. */
export interface NodePresence {
  /** Newest heard-from timestamp the membership entry carries. */
  lastSeen?: number | null;
  /** A direct-connect FC is live by presence — it is removed on disconnect. */
  isDirectFc?: boolean;
}

/** Classify a heard-from timestamp against the shared freshness thresholds. */
export function livenessFromTimestamp(ts: number | null): CommandAgentLiveness {
  if (!ts) return "offline";
  const elapsed = Date.now() - ts;
  if (elapsed < STALE_THRESHOLD_MS) return "live";
  if (elapsed < OFFLINE_THRESHOLD_MS) return "stale";
  return "offline";
}

/** The newest moment this node was heard from, across both presence sources. */
export function nodeLastSeen(
  node: NodePresence,
  status: CommandCloudStatus | undefined,
): number | null {
  const candidates = [node.lastSeen, status?.updatedAt].filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

/**
 * How live a node is right now. A direct-connect FC never ages against the
 * heartbeat clock — its row exists only while its transport is open.
 */
export function nodeLiveness(
  node: NodePresence,
  status: CommandCloudStatus | undefined,
): CommandAgentLiveness {
  if (node.isDirectFc === true) return "live";
  return livenessFromTimestamp(nodeLastSeen(node, status));
}

/**
 * The one rule for reading a node's telemetry from the fleet store: the live
 * stream when it has published, else the heartbeat row's snapshot.
 */
export function telemetryValue(
  telemetry: CommandTelemetrySnapshot | undefined,
  status: CommandCloudStatus | undefined,
): CommandTelemetrySnapshot | undefined {
  return telemetry ?? status?.telemetry;
}
