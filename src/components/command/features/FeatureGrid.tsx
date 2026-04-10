"use client";

/**
 * @module FeatureGrid
 * @description Grid of feature cards grouped by category (Smart Modes, Suites, Utilities).
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import type { ResolvedFeature } from "@/lib/agent/feature-types";
import { FeatureCard } from "./FeatureCard";

interface FeatureGridProps {
  features: ResolvedFeature[];
  onSetup?: (feature: ResolvedFeature) => void;
  onConfigure?: (feature: ResolvedFeature) => void;
  onToggle?: (feature: ResolvedFeature, enabled: boolean) => void;
  onActivate?: (feature: ResolvedFeature) => void;
  onDeactivate?: (feature: ResolvedFeature) => void;
}

interface FeatureGroup {
  label: string;
  features: ResolvedFeature[];
}

export function FeatureGrid({
  features,
  onSetup,
  onConfigure,
  onToggle,
  onActivate,
  onDeactivate,
}: FeatureGridProps) {
  const groups = useMemo((): FeatureGroup[] => {
    const smartModes = features.filter(
      (f) => f.type === "smart-mode"
    );
    const suites = features.filter((f) => f.type === "suite");
    const utilities = features.filter((f) => f.type === "utility");

    const result: FeatureGroup[] = [];
    if (smartModes.length > 0) result.push({ label: "Smart Modes", features: smartModes });
    if (suites.length > 0) result.push({ label: "Mission Suites", features: suites });
    if (utilities.length > 0) result.push({ label: "Utilities", features: utilities });
    return result;
  }, [features]);

  if (features.length === 0) {
    return (
      <div className="text-center py-12 text-text-tertiary text-xs">
        No features match your search.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <div key={group.label}>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">
            {group.label}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {group.features.map((feature) => (
              <FeatureCard
                key={feature.id}
                feature={feature}
                onSetup={onSetup}
                onConfigure={onConfigure}
                onToggle={onToggle}
                onActivate={onActivate}
                onDeactivate={onDeactivate}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
