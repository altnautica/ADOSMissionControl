/**
 * @module AgentCapabilitiesStore
 * @description Zustand store for ADOS agent capabilities: compute, vision,
 * features, models, plus radio + heartbeat health surfaces.
 *
 * This file is a thin barrel. The state shape lives in
 * `agent-capabilities/types.ts`, the normalizer + per-field derivers live in
 * `agent-capabilities/normalizer.ts`, and the Zustand create() call lives in
 * `agent-capabilities/state.ts`. Callers continue to import
 * `useAgentCapabilitiesStore` and the `AgentCapabilitiesStore` type from
 * this path unchanged.
 *
 * @license GPL-3.0-only
 */

export {
  useAgentCapabilitiesStore,
  selectDeviceCapabilities,
  capabilityPresence,
} from "./agent-capabilities/state";
export type {
  AgentCapabilitiesActions,
  AgentCapabilitiesState,
  AgentCapabilitiesStore,
  AgentCapabilitySnapshot,
  AgentProfile,
  AgentRole,
  CapabilityPresence,
  ManualConnectionUrls,
  RuntimeMode,
  WfbFailoverState,
} from "./agent-capabilities/types";
