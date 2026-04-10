/**
 * @module AgentCapabilitiesStore
 * @description Zustand store for ADOS agent capabilities: compute, vision, features, models.
 * Populated from the `capabilities` field in `/api/status/full` polling response.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  AgentCapabilities,
  CameraCapability,
  ComputeCapability,
  VisionState,
  ModelCacheInfo,
  FeatureState,
} from "@/lib/agent/feature-types";

const DEFAULT_COMPUTE: ComputeCapability = {
  npu_available: false,
  npu_runtime: null,
  npu_tops: 0,
  npu_utilization_pct: 0,
  gpu_available: false,
};

const DEFAULT_VISION: VisionState = {
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

const DEFAULT_MODELS: ModelCacheInfo = {
  installed: [],
  cache_used_mb: 0,
  cache_max_mb: 500,
  registry_url: "",
};

const DEFAULT_FEATURES: FeatureState = {
  enabled: [],
  active: null,
};

interface AgentCapabilitiesState {
  tier: number;
  cameras: CameraCapability[];
  compute: ComputeCapability;
  vision: VisionState;
  models: ModelCacheInfo;
  features: FeatureState;
  /** True once we've received at least one capabilities payload. */
  loaded: boolean;
}

interface AgentCapabilitiesActions {
  /** Update all capabilities from a parsed API response. */
  setCapabilities: (caps: AgentCapabilities) => void;
  /** Optimistically mark a feature as enabled (before API confirmation). */
  optimisticEnableFeature: (featureId: string) => void;
  /** Optimistically mark a feature as disabled. */
  optimisticDisableFeature: (featureId: string) => void;
  /** Reset store on disconnect. */
  clear: () => void;
}

export type AgentCapabilitiesStore = AgentCapabilitiesState & AgentCapabilitiesActions;

export const useAgentCapabilitiesStore = create<AgentCapabilitiesStore>((set) => ({
  tier: 0,
  cameras: [],
  compute: DEFAULT_COMPUTE,
  vision: DEFAULT_VISION,
  models: DEFAULT_MODELS,
  features: DEFAULT_FEATURES,
  loaded: false,

  setCapabilities(caps: AgentCapabilities) {
    set({
      tier: caps.tier,
      cameras: caps.cameras,
      compute: caps.compute,
      vision: caps.vision,
      models: caps.models,
      features: caps.features,
      loaded: true,
    });
  },

  optimisticEnableFeature(featureId: string) {
    set((state) => ({
      features: {
        ...state.features,
        enabled: state.features.enabled.includes(featureId)
          ? state.features.enabled
          : [...state.features.enabled, featureId],
      },
    }));
  },

  optimisticDisableFeature(featureId: string) {
    set((state) => ({
      features: {
        ...state.features,
        enabled: state.features.enabled.filter((id) => id !== featureId),
        active: state.features.active === featureId ? null : state.features.active,
      },
    }));
  },

  clear() {
    set({
      tier: 0,
      cameras: [],
      compute: DEFAULT_COMPUTE,
      vision: DEFAULT_VISION,
      models: DEFAULT_MODELS,
      features: DEFAULT_FEATURES,
      loaded: false,
    });
  },
}));
