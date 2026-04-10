"use client";

/**
 * @module FeaturesTab
 * @description Browse, enable, and configure drone features (smart modes, suites, utilities).
 * Replaces the old ModuleStoreTab which showed internal services as "modules".
 * @license GPL-3.0-only
 */

import { useState, useMemo, useCallback } from "react";
import { Search } from "lucide-react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAvailableFeatures } from "@/hooks/use-available-features";
import { AgentDisconnectedPage } from "./AgentDisconnectedPage";
import { FeatureGrid } from "./features/FeatureGrid";
import { CategoryFilter } from "./shared/CategoryFilter";
import type { ResolvedFeature } from "@/lib/agent/feature-types";

type ViewFilter = "all" | "smart-modes" | "suites" | "utilities";

export function FeaturesTab() {
  const connected = useAgentConnectionStore((s) => s.connected);
  const features = useAvailableFeatures();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<ViewFilter>("all");

  // Counts for filter pills
  const smartModeCount = useMemo(
    () => features.filter((f) => f.type === "smart-mode").length,
    [features]
  );
  const suiteCount = useMemo(
    () => features.filter((f) => f.type === "suite").length,
    [features]
  );
  const utilityCount = useMemo(
    () => features.filter((f) => f.type === "utility").length,
    [features]
  );

  const categories = useMemo(
    () => [
      { id: "all" as const, label: "All" },
      { id: "smart-modes" as const, label: "Smart Modes", count: smartModeCount },
      { id: "suites" as const, label: "Suites", count: suiteCount },
      { id: "utilities" as const, label: "Utilities", count: utilityCount },
    ],
    [smartModeCount, suiteCount, utilityCount]
  );

  // Filter features
  const filtered = useMemo(() => {
    let result = features;

    // Type filter
    if (activeFilter === "smart-modes") {
      result = result.filter((f) => f.type === "smart-mode");
    } else if (activeFilter === "suites") {
      result = result.filter((f) => f.type === "suite");
    } else if (activeFilter === "utilities") {
      result = result.filter((f) => f.type === "utility");
    }

    // Search filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.description.toLowerCase().includes(q) ||
          f.id.toLowerCase().includes(q)
      );
    }

    return result;
  }, [features, activeFilter, searchQuery]);

  // Actions (stub for now, will wire to agent API in Phase 3)
  const handleSetup = useCallback((feature: ResolvedFeature) => {
    // TODO: Open SetupWizard dialog
    console.log("[Features] Setup:", feature.id);
    // For now, optimistically enable
    useAgentCapabilitiesStore.getState().optimisticEnableFeature(feature.id);
  }, []);

  const handleConfigure = useCallback((feature: ResolvedFeature) => {
    // TODO: Open FeatureDetailSheet
    console.log("[Features] Configure:", feature.id);
  }, []);

  const handleToggle = useCallback((feature: ResolvedFeature, enabled: boolean) => {
    if (enabled) {
      useAgentCapabilitiesStore.getState().optimisticEnableFeature(feature.id);
    } else {
      useAgentCapabilitiesStore.getState().optimisticDisableFeature(feature.id);
    }
  }, []);

  const handleActivate = useCallback((feature: ResolvedFeature) => {
    // TODO: POST /api/features/{id}/activate
    console.log("[Features] Activate:", feature.id);
  }, []);

  const handleDeactivate = useCallback((feature: ResolvedFeature) => {
    // TODO: POST /api/features/{id}/deactivate
    console.log("[Features] Deactivate:", feature.id);
  }, []);

  if (!connected) {
    return <AgentDisconnectedPage />;
  }

  return (
    <div className="p-4 max-w-5xl space-y-4">
      {/* Search and filter */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1 max-w-sm border border-border-default rounded px-2.5 py-1.5 focus-within:border-accent-primary transition-colors">
          <Search size={12} className="text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search features..."
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary outline-none"
          />
        </div>
        <CategoryFilter
          categories={categories}
          active={activeFilter}
          onChange={(id) => setActiveFilter(id as ViewFilter)}
        />
      </div>

      {/* Feature grid */}
      <FeatureGrid
        features={filtered}
        onSetup={handleSetup}
        onConfigure={handleConfigure}
        onToggle={handleToggle}
        onActivate={handleActivate}
        onDeactivate={handleDeactivate}
      />
    </div>
  );
}
