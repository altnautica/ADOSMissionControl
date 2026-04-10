/**
 * @module useAvailableFeatures
 * @description Intersects the static feature catalog with agent capabilities
 * to produce resolved features with real availability, enabled, and active state.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { FEATURE_CATALOG } from "@/lib/agent/feature-catalog";
import type { ResolvedFeature, FeatureStatus } from "@/lib/agent/feature-types";

export function useAvailableFeatures(): ResolvedFeature[] {
  const loaded = useAgentCapabilitiesStore((s) => s.loaded);
  const tier = useAgentCapabilitiesStore((s) => s.tier);
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);
  const compute = useAgentCapabilitiesStore((s) => s.compute);
  const enabledFeatures = useAgentCapabilitiesStore((s) => s.features.enabled);
  const activeFeature = useAgentCapabilitiesStore((s) => s.features.active);
  const vision = useAgentCapabilitiesStore((s) => s.vision);

  return useMemo(() => {
    return Object.values(FEATURE_CATALOG).map((def): ResolvedFeature => {
      const isEnabled = enabledFeatures.includes(def.id);
      const isActive = activeFeature === def.id;
      const missingSensors: string[] = [];

      // Check sensor availability
      for (const req of def.sensorsRequired) {
        if (!req.required) continue;
        let met = false;
        switch (req.type) {
          case "camera":
            met = cameras.length > 0;
            break;
          case "npu":
            met = compute.npu_available;
            break;
          case "gps":
          case "imu":
            // GPS and IMU are FC sensors, always available if FC connected
            met = true;
            break;
          case "rangefinder":
          case "lidar":
          case "thermal":
            // Optional hardware sensors. For now assume not available unless we track them.
            met = loaded ? true : false;
            break;
          default:
            met = true;
        }
        if (!met) missingSensors.push(req.label);
      }

      // Check tier
      const tierMet = !loaded || tier >= def.tierRequired;

      // Determine status
      let status: FeatureStatus;
      let statusReason: string | undefined;

      if (!loaded) {
        status = "available";
      } else if (missingSensors.length > 0 || !tierMet) {
        status = "unavailable";
        if (!tierMet) {
          statusReason = `Requires Tier ${def.tierRequired}+ (current: Tier ${tier})`;
        } else {
          statusReason = `Missing: ${missingSensors.join(", ")}`;
        }
      } else if (isActive) {
        if (vision.engine_state === "degraded") {
          status = "degraded";
          statusReason = vision.error_message ?? "Performance degraded";
        } else if (vision.engine_state === "error") {
          status = "error";
          statusReason = vision.error_message ?? "Vision engine error";
        } else {
          status = "active";
        }
      } else if (isEnabled) {
        status = "enabled";
      } else {
        status = "available";
      }

      return {
        ...def,
        status,
        enabled: isEnabled,
        active: isActive,
        setupComplete: isEnabled,
        missingSensors,
        statusReason,
      };
    });
  }, [loaded, tier, cameras, compute, enabledFeatures, activeFeature, vision]);
}

/** Filter resolved features by type. */
export function useFeaturesByType(type: ResolvedFeature["type"]): ResolvedFeature[] {
  const all = useAvailableFeatures();
  return useMemo(() => all.filter((f) => f.type === type), [all, type]);
}

/** Filter resolved features by category. */
export function useFeaturesByCategory(category: ResolvedFeature["category"]): ResolvedFeature[] {
  const all = useAvailableFeatures();
  return useMemo(() => all.filter((f) => f.category === category), [all, category]);
}
