"use client";

/**
 * @module DronePluginStatusPill
 * @description Lifecycle pill rendered on the per-drone plugin card.
 * Color-coded per the management UX spec (running green, enabled
 * blue, disabled grey, crashed red). "Stopped" is a plugin the node itself
 * stopped (a tamper refusal, a revoked signer), which is not a crash.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

export type DronePluginStatusLabel =
  | "running"
  | "enabled"
  | "disabled"
  | "crashed"
  | "stopped"
  | "installed";

interface DronePluginStatusPillProps {
  label: DronePluginStatusLabel;
  className?: string;
}

const PALETTE: Record<DronePluginStatusLabel, string> = {
  running: "border-status-success/40 bg-status-success/10 text-status-success",
  enabled: "border-accent-primary/40 bg-accent-primary/10 text-accent-primary",
  disabled: "border-text-secondary/30 bg-bg-tertiary text-text-tertiary",
  crashed: "border-status-error/40 bg-status-error/10 text-status-error",
  stopped: "border-status-error/40 bg-status-error/10 text-status-error",
  installed: "border-text-secondary/30 bg-bg-tertiary text-text-tertiary",
};

export function DronePluginStatusPill({
  label,
  className,
}: DronePluginStatusPillProps) {
  const t = useTranslations("dronePlugins");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
        PALETTE[label],
        className,
      )}
    >
      {t(`status.${label}`)}
    </span>
  );
}
