"use client";

import { useTranslations } from "next-intl";
import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
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

/**
 * How a set bit reads. `health`: a capability the estimator has (green when
 * set). `caution`: a degraded mode (amber when set). `fault`: an error (red
 * when set, green when clear).
 */
type FlagKind = "health" | "caution" | "fault";

interface FlagDef {
  mask: number;
  label: string;
  short: string;
  kind: FlagKind;
}

/** The position/velocity bits shared by ESTIMATOR_STATUS and EKF_STATUS_REPORT. */
function solutionFlags(prefix: string): FlagDef[] {
  return [
    { mask: 0x0001, label: `${prefix}_ATTITUDE`, short: "ATT", kind: "health" },
    { mask: 0x0002, label: `${prefix}_VELOCITY_HORIZ`, short: "VH", kind: "health" },
    { mask: 0x0004, label: `${prefix}_VELOCITY_VERT`, short: "VV", kind: "health" },
    { mask: 0x0008, label: `${prefix}_POS_HORIZ_REL`, short: "PHR", kind: "health" },
    { mask: 0x0010, label: `${prefix}_POS_HORIZ_ABS`, short: "PHA", kind: "health" },
    { mask: 0x0020, label: `${prefix}_POS_VERT_ABS`, short: "PVA", kind: "health" },
    { mask: 0x0040, label: `${prefix}_POS_VERT_AGL`, short: "AGL", kind: "health" },
    // Constant-position mode: the estimator is not using external measurements.
    { mask: 0x0080, label: `${prefix}_CONST_POS_MODE`, short: "CPS", kind: "caution" },
    { mask: 0x0100, label: `${prefix}_PRED_POS_HORIZ_REL`, short: "PPR", kind: "health" },
    { mask: 0x0200, label: `${prefix}_PRED_POS_HORIZ_ABS`, short: "PPA", kind: "health" },
  ];
}

/** ESTIMATOR_STATUS_FLAGS. */
export const ESTIMATOR_FLAGS: FlagDef[] = [
  ...solutionFlags("ESTIMATOR"),
  { mask: 0x0400, label: "ESTIMATOR_GPS_GLITCH", short: "GLT", kind: "fault" },
  { mask: 0x0800, label: "ESTIMATOR_ACCEL_ERROR", short: "ACE", kind: "fault" },
];

/** EKF_STATUS_FLAGS, carried by EKF_STATUS_REPORT.flags. */
export const EKF_REPORT_FLAGS: FlagDef[] = [
  ...solutionFlags("EKF"),
  { mask: 0x0400, label: "EKF_UNINITIALIZED", short: "UNI", kind: "fault" },
  { mask: 0x8000, label: "EKF_GPS_GLITCHING", short: "GLT", kind: "fault" },
];

export function flagDotClass(kind: FlagKind, isSet: boolean): string {
  switch (kind) {
    case "fault":
      return isSet ? "bg-status-error" : "bg-status-success";
    case "caution":
      return isSet ? "bg-status-warning" : "bg-bg-tertiary";
    case "health":
      return isSet ? "bg-status-success" : "bg-bg-tertiary";
  }
}

function FlagDots({ title, flags, defs }: { title: string; flags: number; defs: FlagDef[] }) {
  return (
    <div className="pt-1 border-t border-border-default/30">
      <div className="text-[9px] font-mono text-text-tertiary mb-1">
        {title} (0x{flags.toString(16).toUpperCase().padStart(4, "0")})
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
        {defs.map(({ mask, label, short, kind }) => {
          const isSet = (flags & mask) !== 0;
          return (
            <Tooltip key={mask} content={label}>
              <div className="flex items-center gap-0.5" data-flag={label} data-flag-set={isSet}>
                <div className={cn("w-1.5 h-1.5 rounded-full", flagDotClass(kind, isSet))} />
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
  );
}

function getBarColor(value: number): string {
  if (value < 0.5) return "bg-status-success";
  if (value < 0.8) return "bg-status-warning";
  return "bg-status-error";
}

/**
 * Horizontal bars showing EKF variance levels.
 * Green (<0.5), yellow (0.5-0.8), red (>0.8).
 * Also decodes the EKF_STATUS_REPORT and ESTIMATOR_STATUS flag words as
 * colored dots. Only fresh
 * samples are drawn: variances that stopped arriving read as no data.
 */
export function EkfStatusBars({ className }: { className?: string }) {
  const t = useTranslations("indicators");
  const latest = useFreshTelemetry("ekf");
  const estLatest = useFreshTelemetry("estimatorStatus");

  if (!latest) {
    const heard = useTelemetryStore.getState().ekf.latest() !== undefined;
    return (
      <div
        className={cn("text-[10px]", heard ? "text-status-error" : "text-text-tertiary", className)}
        data-telemetry-stale={heard || undefined}
      >
        {heard ? `EKF · ${t("telemetryNone")}` : t("noEkfData")}
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

      {/* EKF_STATUS_REPORT flags decode */}
      <FlagDots title={t("ekfFlags")} flags={latest.flags} defs={EKF_REPORT_FLAGS} />

      {/* ESTIMATOR_STATUS flags decode */}
      {estLatest && (
        <FlagDots title={t("estimatorFlags")} flags={estLatest.flags} defs={ESTIMATOR_FLAGS} />
      )}
    </div>
  );
}
