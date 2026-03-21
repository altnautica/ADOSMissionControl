"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useSensorHealthStore } from "@/stores/sensor-health-store";
import { cn } from "@/lib/utils";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Check, X, AlertTriangle, Minus, ChevronDown,
} from "lucide-react";

const STATUS_CONFIG = {
  healthy: { color: "text-status-success", bg: "bg-status-success/10", Icon: Check },
  unhealthy: { color: "text-status-warning", bg: "bg-status-warning/10", Icon: AlertTriangle },
  error: { color: "text-status-error", bg: "bg-status-error/10", Icon: X },
  not_present: { color: "text-text-tertiary", bg: "bg-bg-tertiary/50", Icon: Minus },
} as const;

/**
 * 32-sensor status grid decoded from MAV_SYS_STATUS_SENSOR bitmask.
 * Shows only present sensors by default, expandable to show all.
 * Clicking a sensor row expands detailed telemetry info.
 */
export function SensorHealthGrid({
  showAll = false,
  compact = false,
  className,
}: {
  showAll?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const t = useTranslations("indicators");
  const sensors = useSensorHealthStore((s) => s.sensors);
  const healthyCount = useSensorHealthStore((s) => s.getHealthySensorCount());
  const totalPresent = useSensorHealthStore((s) => s.getTotalPresentCount());
  const lastUpdate = useSensorHealthStore((s) => s.lastUpdate);
  const [expandedBits, setExpandedBits] = useState<Set<number>>(new Set());

  const toggleExpand = useCallback((bit: number) => {
    setExpandedBits((prev) => {
      const next = new Set(prev);
      if (next.has(bit)) next.delete(bit);
      else next.add(bit);
      return next;
    });
  }, []);

  const displayed = showAll ? sensors : sensors.filter((s) => s.present);

  if (displayed.length === 0) {
    return (
      <div className={cn("text-xs text-text-tertiary", className)}>
        {t("noSensorData")}
      </div>
    );
  }

  if (compact) {
    return (
      <div className={cn("flex items-center gap-1", className)}>
        <span className="text-[10px] font-mono text-text-secondary">
          {healthyCount}/{totalPresent}
        </span>
        <div className="flex gap-px">
          {displayed.map((sensor) => {
            const cfg = STATUS_CONFIG[sensor.status];
            return (
              <Tooltip key={sensor.bit} content={`${sensor.label}: ${sensor.status}`}>
                <div className={cn("w-1.5 h-1.5 rounded-sm", cfg.color.replace("text-", "bg-"))} />
              </Tooltip>
            );
          })}
        </div>
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
                  <span>{sensor.bit} (0x{(1 << sensor.bit).toString(16).toUpperCase()})</span>
                </div>
                {lastUpdate > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-tertiary">{t("lastUpdate")}</span>
                    <span>{new Date(lastUpdate).toLocaleTimeString()}</span>
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
