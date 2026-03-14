/**
 * @module FlyabilityOverlay
 * @description Full-width verdict banner at top of viewport.
 * Green/yellow/red with icon and text based on flyability assessment.
 * @license GPL-3.0-only
 */

"use client";

import { CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import { useAirspaceStore } from "@/stores/airspace-store";
import { cn } from "@/lib/utils";
import type { FlyabilityVerdict } from "@/lib/airspace/types";

const VERDICT_STYLES: Record<FlyabilityVerdict, { icon: typeof CheckCircle; text: string; bg: string; border: string }> = {
  clear: {
    icon: CheckCircle,
    text: "text-green-400",
    bg: "bg-green-500/15",
    border: "border-green-500/30",
  },
  advisory: {
    icon: AlertTriangle,
    text: "text-yellow-400",
    bg: "bg-yellow-500/15",
    border: "border-yellow-500/30",
  },
  restricted: {
    icon: XCircle,
    text: "text-red-400",
    bg: "bg-red-500/15",
    border: "border-red-500/30",
  },
};

export function FlyabilityOverlay() {
  const flyability = useAirspaceStore((s) => s.flyability);
  const selectedPoint = useAirspaceStore((s) => s.selectedPoint);

  if (!flyability || !selectedPoint) return null;

  const style = VERDICT_STYLES[flyability.verdict];
  const Icon = style.icon;

  const altText = flyability.maxAltitudeAgl > 0
    ? `up to ${flyability.maxAltitudeAgl}m AGL`
    : "not permitted";

  return (
    <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 max-w-lg pointer-events-auto">
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-lg border backdrop-blur-md text-xs font-mono",
          style.bg,
          style.border
        )}
      >
        <Icon size={16} className={cn(style.text, "shrink-0")} />
        <span className={cn("font-semibold", style.text)}>
          {flyability.verdict === "clear" && `Clear to fly ${altText}`}
          {flyability.verdict === "advisory" && `Advisories active. Review before flying (${altText})`}
          {flyability.verdict === "restricted" && `Flight restricted. Authorization required`}
        </span>
        {flyability.zones.length > 0 && (
          <span className="text-text-tertiary ml-1">
            ({flyability.zones.length} zone{flyability.zones.length > 1 ? "s" : ""})
          </span>
        )}
      </div>
    </div>
  );
}
