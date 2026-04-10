/**
 * @module InferCapabilities
 * @description Infers agent capabilities (NPU, cameras) from existing agent data
 * when the capabilities API is not available (agent < v0.3.20).
 * Uses board SoC name to look up NPU specs and peripherals list for cameras.
 * @license GPL-3.0-only
 */

import type { AgentStatus, PeripheralInfo } from "@/lib/agent/types";
import type { AgentCapabilities, CameraCapability, ComputeCapability } from "./feature-types";

/** Known NPU specs by SoC name. */
const NPU_BY_SOC: Record<string, { tops: number; runtime: "rknn" | "tensorrt" }> = {
  // Rockchip RK3588 family (6 TOPS RKNN)
  RK3588: { tops: 6.0, runtime: "rknn" },
  RK3588S: { tops: 6.0, runtime: "rknn" },
  RK3588S2: { tops: 6.0, runtime: "rknn" },
  RK3582: { tops: 6.0, runtime: "rknn" },
  // Rockchip RK3576 (6 TOPS RKNN)
  RK3576: { tops: 6.0, runtime: "rknn" },
  // Rockchip mid-range
  RK3566: { tops: 0.8, runtime: "rknn" },
  RK3568: { tops: 0.8, runtime: "rknn" },
  // Rockchip vision SoCs
  RV1126: { tops: 2.0, runtime: "rknn" },
  RV1126B: { tops: 2.0, runtime: "rknn" },
  RV1109: { tops: 2.0, runtime: "rknn" },
  RV1106: { tops: 0.5, runtime: "rknn" },
  // NVIDIA Jetson
  "Jetson Orin Nano": { tops: 40.0, runtime: "tensorrt" },
  "Jetson Orin NX": { tops: 100.0, runtime: "tensorrt" },
};

/**
 * Infer capabilities from existing agent status + peripherals.
 * Used as a fallback when the agent doesn't have the /api/capabilities endpoint.
 */
export function inferCapabilities(
  status: AgentStatus | null,
  peripherals: PeripheralInfo[]
): AgentCapabilities | null {
  if (!status) return null;

  const board = status.board;
  if (!board) return null;

  // Infer NPU from SoC
  const soc = board.soc ?? "";
  const npuInfo = NPU_BY_SOC[soc] ?? null;

  const compute: ComputeCapability = {
    npu_available: npuInfo !== null,
    npu_runtime: npuInfo?.runtime ?? null,
    npu_tops: npuInfo?.tops ?? 0,
    npu_utilization_pct: 0,
    gpu_available: false,
  };

  // Infer cameras from peripherals
  const cameras: CameraCapability[] = peripherals
    .filter((p) => p.category === "camera")
    .map((p) => ({
      name: p.name,
      type: "usb" as const,
      device: p.address,
      resolution: p.last_reading?.match(/\d+x\d+/)?.[0] ?? "unknown",
      streaming: p.status === "ok",
    }));

  return {
    tier: board.tier,
    cameras,
    compute,
    vision: {
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
    },
    models: {
      installed: [],
      cache_used_mb: 0,
      cache_max_mb: 500,
      registry_url: "",
    },
    features: {
      enabled: [],
      active: null,
    },
  };
}
