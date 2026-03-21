"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";

interface EkfBar {
  labelKey: string;
  key: "velocityVariance" | "posHorizVariance" | "posVertVariance" | "compassVariance" | "terrainAltVariance";
}

const EKF_BARS: EkfBar[] = [
  { labelKey: "ekfVelocity", key: "velocityVariance" },
  { labelKey: "ekfHorizPos", key: "posHorizVariance" },
  { labelKey: "ekfVertPos", key: "posVertVariance" },
  { labelKey: "ekfCompass", key: "compassVariance" },
  { labelKey: "ekfTerrain", key: "terrainAltVariance" },
];

const ESTIMATOR_FLAGS: { mask: number; label: string; short: string }[] = [
  { mask: 0x0001, label: "ESTIMATOR_ATTITUDE", short: "ATT" },
  { mask: 0x0002, label: "ESTIMATOR_VELOCITY_HORIZ", short: "VH" },
  { mask: 0x0004, label: "ESTIMATOR_VELOCITY_VERT", short: "VV" },
  { mask: 0x0008, label: "ESTIMATOR_POS_HORIZ_REL", short: "PHR" },
  { mask: 0x0010, label: "ESTIMATOR_POS_HORIZ_ABS", short: "PHA" },
  { mask: 0x0020, label: "ESTIMATOR_POS_VERT_ABS", short: "PVA" },
  { mask: 0x0040, label: "ESTIMATOR_POS_VERT_AGL", short: "AGL" },
  { mask: 0x0080, label: "ESTIMATOR_CONST_POS_MODE", short: "CPS" },
  { mask: 0x0100, label: "ESTIMATOR_PRED_POS_HORIZ_REL", short: "PPR" },
  { mask: 0x0200, label: "ESTIMATOR_PRED_POS_HORIZ_ABS", short: "PPA" },
  { mask: 0x0400, label: "ESTIMATOR_GPS_GLITCH", short: "GLT" },
  { mask: 0x0800, label: "ESTIMATOR_ACCEL_ERROR", short: "ACE" },
];

function getBarColor(value: number): string {
  if (value < 0.5) return "bg-status-success";
  if (value < 0.8) return "bg-status-warning";
  return "bg-status-error";
}

/**
 * Horizontal bars showing EKF variance levels.
 * Green (<0.5), yellow (0.5-0.8), red (>0.8).
 * Also decodes ESTIMATOR_STATUS flags bitmask as colored dots.
 */
export function EkfStatusBars({ className }: { className?: string }) {
  const t = useTranslations("indicators");
  const ekf = useTelemetryStore((s) => s.ekf);
  const estimator = useTelemetryStore((s) => s.estimatorStatus);
  const latest = ekf.latest();
  const estLatest = estimator.latest();

  if (!latest) {
    return (
      <div className={cn("text-[10px] text-text-tertiary", className)}>
        {t("noEkfData")}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {EKF_BARS.map(({ labelKey, key }) => {
        const value = latest[key];
        const label = t(labelKey);
        const pct = Math.min(value * 100, 100);
        return (
          <Tooltip key={key} content={`${label}: ${value.toFixed(3)}`}>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] font-mono text-text-tertiary w-12 text-right truncate">
                {label.substring(0, 6)}
              </span>
              <div className="flex-1 h-1.5 bg-bg-tertiary/50 rounded-full overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", getBarColor(value))}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-[9px] font-mono text-text-tertiary w-8 tabular-nums">
                {value.toFixed(2)}
              </span>
            </div>
          </Tooltip>
        );
      })}

      {/* ESTIMATOR_STATUS flags decode */}
      {estLatest && (
        <div className="pt-1 border-t border-border-default/30">
          <div className="text-[9px] font-mono text-text-tertiary mb-1">
            {t("estimatorFlags")} (0x{estLatest.flags.toString(16).toUpperCase().padStart(4, "0")})
          </div>
          <div className="flex flex-wrap gap-x-2 gap-y-0.5">
            {ESTIMATOR_FLAGS.map(({ mask, label, short }) => {
              const isSet = (estLatest.flags & mask) !== 0;
              const isError = mask === 0x0400 || mask === 0x0800;
              const dotColor = isError
                ? (isSet ? "bg-status-error" : "bg-status-success")
                : (isSet ? "bg-status-success" : "bg-bg-tertiary");
              return (
                <Tooltip key={mask} content={label}>
                  <div className="flex items-center gap-0.5">
                    <div className={cn("w-1.5 h-1.5 rounded-full", dotColor)} />
                    <span className={cn(
                      "text-[8px] font-mono",
                      isSet ? "text-text-secondary" : "text-text-tertiary/50",
                    )}>
                      {short}
                    </span>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
