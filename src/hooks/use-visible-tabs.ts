/**
 * @module useVisibleTabs
 * @description Derives which Command sub-tabs should be visible based on agent capabilities.
 * The Smart Modes tab only appears when vision features are enabled and hardware supports them.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { FEATURE_CATALOG } from "@/lib/agent/feature-catalog";

export type StaticTab = "overview" | "features" | "system" | "scripts";
export type DynamicTab = "smart-modes";
export type CommandSubTab = StaticTab | DynamicTab;

export function useVisibleTabs(): CommandSubTab[] {
  const loaded = useAgentCapabilitiesStore((s) => s.loaded);
  const tier = useAgentCapabilitiesStore((s) => s.tier);
  const enabledFeatures = useAgentCapabilitiesStore((s) => s.features.enabled);
  const cameras = useAgentCapabilitiesStore((s) => s.cameras);
  const npuAvailable = useAgentCapabilitiesStore((s) => s.compute.npu_available);

  return useMemo(() => {
    const tabs: CommandSubTab[] = ["overview", "features"];

    // Show Smart Modes tab when:
    // 1. At least one smart-mode or vision-requiring feature is enabled
    // 2. Camera is detected
    // 3. NPU or sufficient tier exists
    if (loaded) {
      const hasSmartMode = enabledFeatures.some((id) => {
        const feat = FEATURE_CATALOG[id];
        return feat?.type === "smart-mode" || feat?.visionBehavior;
      });
      const hasCamera = cameras.length > 0;
      const hasCompute = npuAvailable || tier >= 3;

      if (hasSmartMode && hasCamera && hasCompute) {
        tabs.push("smart-modes");
      }
    }

    tabs.push("system", "scripts");
    return tabs;
  }, [loaded, tier, enabledFeatures, cameras, npuAvailable]);
}
