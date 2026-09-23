"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useSensorHealth } from "@/hooks/use-sensor-health";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Check, X, Minus, ChevronDown,
} from "lucide-react";

const STATUS_CONFIG = {
  healthy: { color: "text-status-success", bg: "bg-status-success/10", Icon: Check },
  error: { color: "text-status-error", bg: "bg-status-error/10", Icon: X },
  disabled: { color: "text-text-secondary", bg: "bg-bg-tertiary/50", Icon: Minus },
  not_present: { color: "text-text-tertiary", bg: "bg-bg-tertiary/50", Icon: Minus },
} as const;

/**
 * The one sensor-health view, decoded from the selected drone's SYS_STATUS
 * (MAV_SYS_STATUS_SENSOR bitmasks). Present sensors only by default,
 * expandable to all; `compact` is a count plus one dot per sensor. A
 * SYS_STATUS that stopped arriving renders as no data, never as the last
 * sensor verdicts.
 */
export function SensorHealthGrid({
  showAll = false,
  compact = false,
  fcLive = true,
  className,
}: {
  showAll?: boolean;
  compact?: boolean;
  /**
   * False when the surface knows no FC is attached; no sensor claims are shown
   * whatever the telemetry ring still holds.
   */
  fcLive?: boolean;
  className?: string;
}) {
  const t = useTranslations("indicators");
  const health = useSensorHealth();
  const [expandedBits, setExpandedBits] = useState<Set<number>>(new Set());

  const toggleExpand = useCallback((bit: number) => {
    setExpandedBits((prev) => {
      const next = new Set(prev);
      if (next.has(bit)) next.delete(bit);
      else next.add(bit);
      return next;
    });
  }, []);

  const sensors = fcLive ? health.sensors : null;

  if (!sensors && fcLive && health.heard) {
    return (
      <div className={cn("text-xs text-status-error", className)} data-telemetry-stale>
        Sensors · {t("telemetryNone")}
      </div>
    );
  }

  const displayed = sensors ? (showAll ? sensors : sensors.filter((s) => s.present)) : [];

  if (displayed.length === 0) {
    return (
      <div className={cn("text-xs text-text-tertiary", className)}>
        {t("noSensorData")}
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
        <span className="text-[10px] font-mono text-text-secondary">
          {health.healthyCount}/{health.presentCount}
        </span>
        {displayed.map((sensor) => {
          const cfg = STATUS_CONFIG[sensor.status];
          return (
            <Tooltip key={sensor.bit} content={`${sensor.label}: ${sensor.status}`}>
              <span className="flex items-center gap-1">
                <span className={cn("w-1.5 h-1.5 rounded-full", cfg.color.replace("text-", "bg-"))} />
                <span className={cn("font-mono text-[9px]", sensor.status === "healthy" ? "text-text-secondary" : cfg.color)}>
                  {sensor.shortLabel}
                </span>
              </span>
            </Tooltip>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn("grid grid-cols-4 gap-1", className)}>
      {displayed.map((sensor) => {
        const cfg = STATUS_CONFIG[sensor.status];
        const Icon = cfg.Icon;
        const isExpanded = expandedBits.has(sensor.bit);
        return (
          <div key={sensor.bit} className={cn(isExpanded && "col-span-4")}>
            <button
              onClick={() => toggleExpand(sensor.bit)}
              className={cn(
                "flex items-center gap-1 px-1.5 py-1 rounded text-[10px] w-full text-left cursor-pointer",
                cfg.bg,
                "hover:brightness-125 transition-all",
              )}
            >
              <Icon size={10} className={cfg.color} />
              <span className={cn("truncate flex-1", cfg.color)}>{sensor.label}</span>
              <ChevronDown
                size={8}
                className={cn(
                  "text-text-tertiary transition-transform duration-200",
                  isExpanded && "rotate-180",
                )}
              />
            </button>
            {isExpanded && (
              <div className="px-2 py-1.5 mt-0.5 rounded bg-bg-tertiary/30 border border-border-default/30 text-[9px] font-mono text-text-secondary space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="flex justify-between">
                  <span className="text-text-tertiary">{t("status")}</span>
                  <span className={cfg.color}>{sensor.status}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">{t("present")}</span>
                  <span>{sensor.present ? t("yes") : t("no")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">{t("enabled")}</span>
                  <span>{sensor.enabled ? t("yes") : t("no")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">{t("healthy")}</span>
                  <span>{sensor.healthy ? t("yes") : t("no")}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-tertiary">{t("bit")}</span>
                  <span>{sensor.bit} (0x{(2 ** sensor.bit).toString(16).toUpperCase()})</span>
                </div>
                {health.updatedAt !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">{t("lastUpdate")}</span>
                    <span>{new Date(health.updatedAt).toLocaleTimeString()}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
