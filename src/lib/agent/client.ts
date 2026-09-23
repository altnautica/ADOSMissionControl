/**
 * @module AgentClient
 * @description Barrel re-export of the REST client for the ADOS Drone
 * Agent. The class itself plus the per-domain helpers live under
 * `src/lib/agent/agent-client/`. Existing imports against
 * `@/lib/agent/client` continue to work.
 * @license GPL-3.0-only
 */

export { AgentClient } from "./agent-client/client";
export { agentSupports } from "./agent-client/version-cache";
export { normaliseSystemResources } from "./agent-client/system";
export { SigningPartialEnrollError } from "./agent-client/extras";
export type {
  CameraEntry,
  CameraListResponse,
  RecordingControlResponse,
  RecordingFileEntry,
  RecordingListResponse,
  SigningCapability,
  SigningCounters,
  SigningEnrollResult,
} from "./agent-client/types";
