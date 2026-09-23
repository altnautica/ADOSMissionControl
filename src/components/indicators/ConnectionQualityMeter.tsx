"use client";

import { useTranslations } from "next-intl";
import { useConnectionQuality } from "@/hooks/use-connection-quality";
import { cn } from "@/lib/utils";

/**
 * Signal bars for connection quality display. RADIO_STATUS measures no latency,
 * so none is shown; the tooltip gives signal, RSSI and free TX buffer.
 * Renders 4 bars that fill based on signal quality rating. A radio that has
 * stopped reporting renders as an explicit no-data state (empty bars, red
 * outline), never as its last reading.
 */
export function ConnectionQualityMeter({ className }: { className?: string }) {
  const t = useTranslations("indicators");
  const { quality, stale, signalStrength, txBuf, rssi } = useConnectionQuality();

  if (quality === "unknown") return null;

  if (stale) {
    return (
      <div
        className={cn("flex items-center gap-1.5", className)}
        title={`${t("signal")}: ${t("telemetryNone")}`}
        data-testid="connection-quality-stale"
      >
        <div className="flex items-end gap-px h-3.5">
          {[1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className="w-[3px] rounded-sm border border-status-error/70 bg-transparent"
              style={{ height: `${level * 25}%` }}
            />
          ))}
        </div>
        <span className="text-[9px] font-mono text-status-error">{t("telemetryNone")}</span>
      </div>
    );
  }

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
    <div className={cn("flex items-center gap-1.5", className)} title={`${t("signal")}: ${Math.round(signalStrength)}% | ${t("rssi")}: ${rssi} | ${t("txBufferFree")}: ${txBuf}%`}>
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
    </div>
  );
}
