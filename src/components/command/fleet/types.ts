/**
 * @module fleet/types
 * @description Shared types and helpers for fleet sidebar sub-components.
 * @license GPL-3.0-only
 */

import type { PairedDrone } from "@/stores/pairing-store";
import { nodeLiveness, type CommandAgentLiveness } from "@/lib/nodes/presence";

/** Presence of a sidebar fleet entry: the shared node rule, judged from the
 * entry's own heard-from timestamp (a direct-connect FC is live by presence). */
export function droneLiveness(
  drone: PairedDrone & { isDirectFc?: boolean },
): CommandAgentLiveness {
  return nodeLiveness(drone, undefined);
}
