/**
 * @module AgentCapabilitiesStore
 * @description Zustand store for ADOS agent capabilities: compute, vision, features, models.
 * Populated from the `capabilities` field in `/api/status/full` polling response.
 * Includes a normalizer to handle shape differences between agent API response and GCS types.
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

// ── Normalizer ──────────────────────────────────────────
// Maps agent API response shape to GCS TypeScript types.
// The agent may return fields with different names or shapes
// (e.g., no npu_available, features as array instead of { enabled, active }).

function normalizeFeatures(raw: unknown): FeatureState {
  // Agent sends array of feature objects with { id, enabled, active, ... }
  if (Array.isArray(raw)) {
    return {
      enabled: raw.filter((f) => f.enabled).map((f) => f.id as string),
      active: (raw.find((f) => f.active)?.id as string) ?? null,
    };
  }
  // Already in GCS format (from mock or inference)
  if (raw && typeof raw === "object" && "enabled" in raw) {
    return raw as FeatureState;
  }
  return { enabled: [], active: null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeCapabilities(raw: any): AgentCapabilities {
  if (!raw || typeof raw !== "object") {
    return {
      tier: 0,
      cameras: [],
      compute: DEFAULT_COMPUTE,
      vision: DEFAULT_VISION,
      models: DEFAULT_MODELS,
      features: DEFAULT_FEATURES,
    };
  }

  // Normalize compute: infer npu_available from npu_tops > 0
  const rawCompute = raw.compute ?? {};
  const npuTops = Number(rawCompute.npu_tops ?? 0);
  const compute: ComputeCapability = {
    npu_available: rawCompute.npu_available ?? npuTops > 0,
    npu_runtime: rawCompute.npu_runtime ?? null,
    npu_tops: npuTops,
    npu_utilization_pct: Number(rawCompute.npu_utilization_pct ?? 0),
    gpu_available: Boolean(rawCompute.gpu_available ?? false),
  };

  // Normalize cameras: default streaming to true, type to "usb"
  const cameras: CameraCapability[] = (Array.isArray(raw.cameras) ? raw.cameras : []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => ({
      name: c.name ?? "Unknown Camera",
      type: c.type ?? "usb",
      device: c.device,
      resolution: c.resolution ?? "unknown",
      fps: c.fps,
      streaming: c.streaming ?? true, // Agent-detected cameras are streaming
    })
  );

  // Normalize vision: merge with defaults
  const vision: VisionState = { ...DEFAULT_VISION };
  if (raw.vision && typeof raw.vision === "object") {
    const v = raw.vision;
    if (v.engine_state) vision.engine_state = v.engine_state;
    if (v.active_behavior) vision.active_behavior = v.active_behavior;
    if (v.behavior_state) vision.behavior_state = v.behavior_state;
    if (typeof v.fps === "number") vision.fps = v.fps;
    if (typeof v.inference_ms === "number") vision.inference_ms = v.inference_ms;
    if (v.model_loaded) vision.model_loaded = v.model_loaded;
    if (typeof v.track_count === "number") vision.track_count = v.track_count;
    if (typeof v.target_locked === "boolean") vision.target_locked = v.target_locked;
    if (typeof v.target_confidence === "number") vision.target_confidence = v.target_confidence;
    if (v.obstacle_mode) vision.obstacle_mode = v.obstacle_mode;
    if (typeof v.nearest_obstacle_m === "number") vision.nearest_obstacle_m = v.nearest_obstacle_m;
    if (v.threat_level) vision.threat_level = v.threat_level;
    // Also check the agent's vision.enabled + npu_tops fields (agent shape)
    if (v.enabled === true && vision.engine_state === "off") {
      vision.engine_state = "ready";
    }
  }

  // Normalize models
  const models: ModelCacheInfo = {
    installed: Array.isArray(raw.models) ? raw.models : raw.models?.installed ?? [],
    cache_used_mb: raw.models?.cache_used_mb ?? 0,
    cache_max_mb: raw.models?.cache_max_mb ?? 500,
    registry_url: raw.models?.registry_url ?? "",
  };

  return {
    tier: Number(raw.tier ?? 0),
    cameras,
    compute,
    vision,
    models,
    features: normalizeFeatures(raw.features),
  };
}

// ── Store ────────────────────────────────────────────────

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
  /** Update all capabilities from a parsed API response (normalizes shape). */
  setCapabilities: (caps: AgentCapabilities | Record<string, unknown>) => void;
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

  setCapabilities(caps: AgentCapabilities | Record<string, unknown>) {
    const normalized = normalizeCapabilities(caps);
    set({
      tier: normalized.tier,
      cameras: normalized.cameras,
      compute: normalized.compute,
      vision: normalized.vision,
      models: normalized.models,
      features: normalized.features,
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
