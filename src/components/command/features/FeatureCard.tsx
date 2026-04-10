"use client";

/**
 * @module FeatureCard
 * @description Card for a single feature showing status, sensor requirements, and actions.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import {
  Check,
  X,
  Settings,
  Play,
  Square,
  Loader2,
  AlertTriangle,
  CircleDot,
} from "lucide-react";
import * as LucideIcons from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResolvedFeature } from "@/lib/agent/feature-types";

interface FeatureCardProps {
  feature: ResolvedFeature;
  onSetup?: (feature: ResolvedFeature) => void;
  onConfigure?: (feature: ResolvedFeature) => void;
  onToggle?: (feature: ResolvedFeature, enabled: boolean) => void;
  onActivate?: (feature: ResolvedFeature) => void;
  onDeactivate?: (feature: ResolvedFeature) => void;
}

const STATUS_CONFIG: Record<
  ResolvedFeature["status"],
  { label: string; dotClass: string; badgeClass: string }
> = {
  unavailable: {
    label: "Unavailable",
    dotClass: "bg-text-tertiary",
    badgeClass: "bg-bg-tertiary text-text-tertiary",
  },
  available: {
    label: "Available",
    dotClass: "bg-text-secondary",
    badgeClass: "bg-bg-tertiary text-text-secondary",
  },
  "setup-required": {
    label: "Setup Required",
    dotClass: "bg-accent-primary",
    badgeClass: "bg-accent-primary/15 text-accent-primary",
  },
  enabled: {
    label: "Enabled",
    dotClass: "bg-status-success",
    badgeClass: "bg-status-success/15 text-status-success",
  },
  active: {
    label: "Active",
    dotClass: "bg-status-success animate-pulse",
    badgeClass: "bg-status-success/15 text-status-success",
  },
  degraded: {
    label: "Degraded",
    dotClass: "bg-status-warning animate-pulse",
    badgeClass: "bg-status-warning/15 text-status-warning",
  },
  error: {
    label: "Error",
    dotClass: "bg-status-error",
    badgeClass: "bg-status-error/15 text-status-error",
  },
};

function getIcon(iconName: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const icons = LucideIcons as any;
  const Icon = icons[iconName] as React.ComponentType<{ size?: number; className?: string }> | undefined;
  return Icon ?? LucideIcons.Package;
}

export function FeatureCard({
  feature,
  onSetup,
  onConfigure,
  onToggle,
  onActivate,
  onDeactivate,
}: FeatureCardProps) {
  const config = STATUS_CONFIG[feature.status];
  const Icon = useMemo(() => getIcon(feature.icon), [feature.icon]);
  const isUnavailable = feature.status === "unavailable";
  const isActive = feature.status === "active";
  const isEnabled = feature.enabled;

  return (
    <div
      className={cn(
        "border rounded-lg p-3.5 transition-all",
        isUnavailable
          ? "border-border-default/50 bg-bg-secondary/50 opacity-60"
          : isActive
            ? "border-status-success/40 bg-bg-secondary"
            : isEnabled
              ? "border-accent-primary/30 bg-bg-secondary"
              : "border-border-default bg-bg-secondary hover:border-border-default/80"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              "flex items-center justify-center w-7 h-7 rounded shrink-0",
              isUnavailable ? "bg-bg-tertiary" : "bg-accent-primary/10"
            )}
          >
            <Icon
              size={14}
              className={isUnavailable ? "text-text-tertiary" : "text-accent-primary"}
            />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-medium text-text-primary truncate">
              {feature.name}
            </h4>
          </div>
        </div>
        {/* Status badge */}
        <span
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded shrink-0",
            config.badgeClass
          )}
        >
          <span className={cn("w-1.5 h-1.5 rounded-full", config.dotClass)} />
          {config.label}
        </span>
      </div>

      {/* Description */}
      <p className="text-[11px] text-text-tertiary leading-relaxed mb-2.5 line-clamp-2">
        {feature.description}
      </p>

      {/* Sensor requirements */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {feature.sensorsRequired.map((sensor) => {
          const isMissing = feature.missingSensors.includes(sensor.label);
          return (
            <span
              key={sensor.type}
              className={cn(
                "inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded",
                isMissing
                  ? "bg-status-error/10 text-status-error"
                  : "bg-status-success/10 text-status-success"
              )}
            >
              {isMissing ? <X size={8} /> : <Check size={8} />}
              {sensor.label}
            </span>
          );
        })}
      </div>

      {/* Status reason (for unavailable/degraded/error) */}
      {feature.statusReason && (
        <p className="text-[10px] text-text-tertiary mb-2.5 flex items-center gap-1">
          <AlertTriangle size={10} className="shrink-0 text-status-warning" />
          {feature.statusReason}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {isUnavailable ? (
          <span className="text-[10px] text-text-tertiary">
            Hardware requirements not met
          </span>
        ) : isActive ? (
          <>
            <button
              onClick={() => onDeactivate?.(feature)}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded bg-status-error/15 text-status-error hover:bg-status-error/25 transition-colors"
            >
              <Square size={10} />
              Stop
            </button>
            <button
              onClick={() => onConfigure?.(feature)}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
            >
              <Settings size={10} />
              Configure
            </button>
          </>
        ) : isEnabled ? (
          <>
            <button
              onClick={() => onActivate?.(feature)}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 transition-colors"
            >
              <Play size={10} />
              Activate
            </button>
            <button
              onClick={() => onConfigure?.(feature)}
              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
            >
              <Settings size={10} />
            </button>
            <button
              onClick={() => onToggle?.(feature, false)}
              className="ml-auto text-[10px] text-text-tertiary hover:text-status-error transition-colors"
            >
              Disable
            </button>
          </>
        ) : (
          <button
            onClick={() => onSetup?.(feature)}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded bg-accent-primary text-white hover:opacity-90 transition-opacity"
          >
            <CircleDot size={10} />
            Setup
          </button>
        )}
      </div>
    </div>
  );
}
