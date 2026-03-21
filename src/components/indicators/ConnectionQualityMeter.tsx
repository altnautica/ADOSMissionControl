"use client";

import { useTranslations } from "next-intl";
import { useConnectionQuality } from "@/hooks/use-connection-quality";
import { cn } from "@/lib/utils";

/**
 * Signal bars + latency badge for connection quality display.
 * Renders 4 bars that fill based on signal quality rating.
 */
export function ConnectionQualityMeter({ className }: { className?: string }) {
  const t = useTranslations("indicators");
  const { quality, signalStrength, latencyMs, rssi } = useConnectionQuality();

  if (quality === "unknown") return null;

  const bars = quality === "excellent" ? 4
    : quality === "good" ? 3
    : quality === "fair" ? 2
    : quality === "poor" ? 1
    : 0;

  const barColor = quality === "excellent" || quality === "good"
    ? "bg-status-success"
    : quality === "fair"
    ? "bg-status-warning"
    : "bg-status-error";

  return (
    <div className={cn("flex items-center gap-1.5", className)} title={`${t("signal")}: ${signalStrength}% | ${t("rssi")}: ${rssi} | ${t("latency")}: ${latencyMs}ms`}>
      {/* Signal bars */}
      <div className="flex items-end gap-px h-3.5">
        {[1, 2, 3, 4].map((level) => (
          <div
            key={level}
            className={cn(
              "w-[3px] rounded-sm transition-colors",
              level <= bars ? barColor : "bg-bg-tertiary",
            )}
            style={{ height: `${level * 25}%` }}
          />
        ))}
      </div>
      {/* Latency badge */}
      {latencyMs > 0 && (
        <span className={cn(
          "text-[9px] font-mono tabular-nums",
          latencyMs < 100 ? "text-text-tertiary" : latencyMs < 500 ? "text-status-warning" : "text-status-error",
        )}>
          {latencyMs}ms
        </span>
      )}
    </div>
  );
}
