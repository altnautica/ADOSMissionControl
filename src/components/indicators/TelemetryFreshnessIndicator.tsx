"use client";

import { useTranslations } from "next-intl";
import { useTelemetryFreshness } from "@/hooks/use-telemetry-freshness";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

type TelemetryChannel = "attitude" | "position" | "battery" | "gps" | "vfr" | "rc" | "sysStatus" | "radio" | "ekf" | "wind" | "navController";

const DISPLAY_CHANNELS: { key: TelemetryChannel; labelKey: string; short: string }[] = [
  { key: "attitude", labelKey: "telemetryChannels.attitude", short: "ATT" },
  { key: "position", labelKey: "telemetryChannels.position", short: "POS" },
  { key: "battery", labelKey: "telemetryChannels.battery", short: "BAT" },
  { key: "gps", labelKey: "telemetryChannels.gps", short: "GPS" },
  { key: "rc", labelKey: "telemetryChannels.rcInput", short: "RC" },
  { key: "radio", labelKey: "telemetryChannels.radio", short: "RAD" },
  { key: "vfr", labelKey: "telemetryChannels.vfrHud", short: "VFR" },
  { key: "sysStatus", labelKey: "telemetryChannels.systemStatus", short: "SYS" },
  { key: "ekf", labelKey: "telemetryChannels.ekf", short: "EKF" },
  { key: "wind", labelKey: "telemetryChannels.wind", short: "WND" },
  { key: "navController", labelKey: "telemetryChannels.navController", short: "NAV" },
];

const FRESHNESS_COLORS = {
  fresh: "bg-status-success",
  stale: "bg-status-warning",
  lost: "bg-status-error",
  none: "bg-bg-tertiary",
} as const;

/**
 * Row of per-channel freshness dots for key telemetry channels.
 * Green = receiving data, yellow = stale, red = lost, gray = never received.
 */
export function TelemetryFreshnessIndicator({ className }: { className?: string }) {
  const t = useTranslations("indicators");
  const { getFreshness } = useTelemetryFreshness();

  const freshnessLabel = {
    fresh: t("telemetryFresh"),
    stale: t("telemetryStale"),
    lost: t("telemetryLost"),
    none: t("telemetryNone"),
  } as const;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {DISPLAY_CHANNELS.map(({ key, labelKey, short }) => {
        const freshness = getFreshness(key);
        const label = t(labelKey);
        return (
          <Tooltip key={key} content={`${label}: ${freshnessLabel[freshness]}`}>
            <div className="flex flex-col items-center gap-0.5">
              <div className={cn("w-1.5 h-1.5 rounded-full transition-colors", FRESHNESS_COLORS[freshness])} />
              <span className="text-[7px] font-mono text-text-tertiary leading-none">{short}</span>
            </div>
          </Tooltip>
        );
      })}
    </div>
  );
}
