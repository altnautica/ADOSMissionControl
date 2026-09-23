/**
 * @module AgentSchemas/MeshNet
 * @description zod schema for the network-peer list the agent ships when
 * running in mesh-aware modes.
 *
 * @license GPL-3.0-only
 */

import { z } from "zod";

import { OptionalNumberLike } from "./primitives";

export const NetworkPeerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    // A peer row that omits a measurement must parse as ABSENT, not as 0: a
    // 0 dBm signal reads as a perfect link and a 0% battery reads as a
    // critical one, and neither was measured.
    signal_dbm: OptionalNumberLike,
    last_seen: z.string(),
    battery_percent: OptionalNumberLike,
    distance_m: OptionalNumberLike,
    tier: OptionalNumberLike,
    link_type: z.string(),
  })
  .passthrough();

export const NetworkPeerListSchema = z.array(NetworkPeerSchema);
