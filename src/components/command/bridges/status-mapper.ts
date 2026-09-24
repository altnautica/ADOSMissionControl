/**
 * @module command/bridges/status-mapper
 * @description Pure mapping helpers that turn a `cmd_droneStatus`
 * Convex row into the shapes the rest of the GCS consumes (AgentStatus,
 * service list, fan-out blocks, capability extras). No React, no
 * Zustand — every call returns a value the bridge component can hand
 * off to the appropriate setter atomically.
 *
 * This file is a thin barrel: the per-domain transforms live in
 * `./status-mapper/*` (agent-status, system, ground-station, urls,
 * heartbeat-extras). Callers keep importing every name from this path
 * unchanged.
 * @license GPL-3.0-only
 */

export { mapCloudStatus } from "./status-mapper/agent-status";
export type { MappedAgentStatus } from "./status-mapper/agent-status";

export { buildSystemUpdate } from "./status-mapper/system";
export type { MappedSystemUpdate } from "./status-mapper/system";

export { buildGroundStationPatch } from "./status-mapper/ground-station";
export type { GroundStationFanOutCurrent } from "./status-mapper/ground-station";

export {
  resolveVideoUrls,
  resolveVideoStreams,
  resolveMavlinkUrl,
} from "./status-mapper/urls";
export type { VideoStreamUrls, MavlinkUrl } from "./status-mapper/urls";

export { buildHeartbeatExtras } from "./status-mapper/heartbeat-extras";
export type { HeartbeatExtras } from "./status-mapper/heartbeat-extras";
