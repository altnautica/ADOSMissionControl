/**
 * @module AgentCapabilities/normalize-defaults
 * @description Neutral seed values for the capability sub-blocks.
 *
 * These are what the store holds before any agent has answered, and what
 * `normalizeCapabilities` falls back to on a payload it cannot read. Every
 * field is the honest "nothing measured" reading — no fabricated tier, no
 * assumed accelerator — so a surface gated on them shows an empty state rather
 * than a confident wrong one.
 *
 * @license GPL-3.0-only
 */

import type {
  ComputeCapability,
  ModelCacheInfo,
  VisionState,
} from "@/lib/agent/feature-types";

export const DEFAULT_COMPUTE: ComputeCapability = {
  npu_available: false,
  npu_runtime: null,
  npu_tops: 0,
  npu_utilization_pct: 0,
  gpu_available: false,
};

export const DEFAULT_VISION: VisionState = {
  engine_state: "off",
  active_behavior: null,
  behavior_state: null,
  fps: 0,
  inference_ms: 0,
  model_loaded: null,
  track_count: 0,
  target_locked: false,
  target_confidence: 0,
  obstacle_mode: "off",
  nearest_obstacle_m: null,
  threat_level: "green",
};

export const DEFAULT_MODELS: ModelCacheInfo = {
  installed: [],
  cache_used_mb: 0,
  cache_max_mb: 500,
  registry_url: "",
};
