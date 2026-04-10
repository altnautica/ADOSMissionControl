/**
 * @module FeatureTypes
 * @description Types for the ADOS feature system: smart modes, suites, and agent capabilities.
 * @license GPL-3.0-only
 */

// ── Sensor & Model Requirements ──────────────────────────

export interface SensorRequirement {
  type: "camera" | "npu" | "gps" | "imu" | "rangefinder" | "lidar" | "thermal";
  label: string;
  required: boolean;
}

export interface ModelRequirement {
  modelId: string;
  required: boolean;
  purpose: string;
}

// ── Config Schema (drives dynamic setup UI) ──────────────

export interface ConfigParam {
  key: string;
  label: string;
  type: "slider" | "select" | "toggle" | "number";
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  description?: string;
}

// ── Feature Definition (static catalog entry) ────────────

export type FeatureCategory = "tracking" | "cinematography" | "safety" | "mission" | "utility";
export type FeatureType = "smart-mode" | "suite" | "utility";

export interface FeatureDef {
  id: string;
  type: FeatureType;
  name: string;
  description: string;
  icon: string;
  category: FeatureCategory;
  tierRequired: number;
  sensorsRequired: SensorRequirement[];
  servicesRequired: string[];
  visionBehavior?: string;
  requiresNpu?: boolean;
  requiredModels?: ModelRequirement[];
  suiteId?: string;
  configSchema?: ConfigParam[];
}

// ── Feature State (resolved from catalog + agent) ────────

export type FeatureStatus =
  | "unavailable"
  | "available"
  | "setup-required"
  | "enabled"
  | "active"
  | "degraded"
  | "error";

export interface ResolvedFeature extends FeatureDef {
  status: FeatureStatus;
  enabled: boolean;
  active: boolean;
  setupComplete: boolean;
  missingSensors: string[];
  statusReason?: string;
}

// ── Agent Capabilities (from /api/status/full) ───────────

export interface CameraCapability {
  name: string;
  type: "csi" | "usb" | "ip";
  device?: string;
  resolution: string;
  fps?: number;
  streaming: boolean;
}

export interface ComputeCapability {
  npu_available: boolean;
  npu_runtime: "rknn" | "tensorrt" | "tflite" | "opencv_dnn" | null;
  npu_tops: number;
  npu_utilization_pct: number;
  gpu_available: boolean;
}

export interface VisionState {
  engine_state: "off" | "initializing" | "ready" | "active" | "degraded" | "error";
  active_behavior: string | null;
  behavior_state: "idle" | "designating" | "searching" | "tracking" | "executing" | "paused" | null;
  fps: number;
  inference_ms: number;
  model_loaded: string | null;
  track_count: number;
  target_locked: boolean;
  target_confidence: number;
  obstacle_mode: "off" | "brake" | "detour";
  nearest_obstacle_m: number | null;
  threat_level: "green" | "yellow" | "red";
  error_message?: string;
}

export interface InstalledModel {
  id: string;
  variant: string;
  format: string;
  size_mb: number;
  loaded: boolean;
}

export interface ModelCacheInfo {
  installed: InstalledModel[];
  cache_used_mb: number;
  cache_max_mb: number;
  registry_url: string;
}

export interface FeatureState {
  enabled: string[];
  active: string | null;
}

export interface AgentCapabilities {
  tier: number;
  cameras: CameraCapability[];
  compute: ComputeCapability;
  vision: VisionState;
  models: ModelCacheInfo;
  features: FeatureState;
}

// ── Detection Data (for vision overlay) ──────────────────

export interface Detection {
  class: string;
  confidence: number;
  bbox: { x: number; y: number; w: number; h: number };
  track_id?: number;
  designated?: boolean;
}

export interface VisionFrame {
  detections: Detection[];
  timestamp: number;
  frame_width: number;
  frame_height: number;
}

// ── Model Registry (from registry.json) ──────────────────

export interface ModelVariantFormat {
  url: string;
  size_mb: number;
  sha256: string;
}

export interface ModelVariant {
  variant: string;
  input_size: string;
  min_tops: number;
  formats: Record<string, ModelVariantFormat>;
}

export interface RegistryModel {
  id: string;
  name: string;
  description: string;
  license: string;
  classes: string[];
  variants: ModelVariant[];
}

export interface ModelRegistry {
  version: number;
  models: RegistryModel[];
}

export interface ModelDownloadStatus {
  model_id: string;
  state: "idle" | "downloading" | "verifying" | "complete" | "error";
  progress: number;
  error?: string;
}
