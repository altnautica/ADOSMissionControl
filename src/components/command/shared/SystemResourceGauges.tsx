"use client";

import { useTranslations } from "next-intl";
import { Cpu, MemoryStick, HardDrive, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SystemResources } from "@/lib/agent/types";
import { useFreshness } from "@/lib/agent/freshness";

interface SystemResourceGaugesProps {
  resources: SystemResources;
}

function barColor(percent: number, stale: boolean): string {
  if (stale) return "bg-text-tertiary/60";
  if (percent >= 90) return "bg-status-error";
  if (percent >= 70) return "bg-status-warning";
  return "bg-accent-primary";
}

function ResourceBar({
  icon: Icon,
  label,
  percent,
  detail,
  stale,
  staleLabel,
}: {
  icon: typeof Cpu;
  label: string;
  percent: number;
  detail: string;
  stale: boolean;
  staleLabel: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className="text-text-tertiary" />
          <span className="text-xs text-text-secondary">{label}</span>
        </div>
        <span
          className={cn(
            "text-xs font-mono",
            stale ? "text-text-tertiary" : "text-text-primary"
          )}
          title={stale ? `Last reading ${staleLabel}` : undefined}
        >
          {percent.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor(percent, stale))}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <p className="text-[10px] text-text-tertiary">{detail}</p>
    </div>
  );
}

export function SystemResourceGauges({ resources }: SystemResourceGaugesProps) {
  const t = useTranslations("agent");
  const freshness = useFreshness();
  const isStale = freshness.state !== "live" && freshness.state !== "unknown";
  return (
    <div
      className={cn(
        "border border-border-default rounded-lg p-4 space-y-4 transition-opacity",
        isStale && "opacity-60"
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">{t("systemResources")}</h3>
        {isStale && (
          <span className="text-[10px] uppercase text-text-tertiary font-mono">
            Paused · {freshness.label}
          </span>
        )}
      </div>

      <ResourceBar
        icon={Cpu}
        label={t("cpu")}
        percent={resources.cpu_percent}
        detail={t("utilization", { percent: resources.cpu_percent.toFixed(1) })}
        stale={isStale}
        staleLabel={freshness.label}
      />

      <ResourceBar
        icon={MemoryStick}
        label={t("memory")}
        percent={resources.memory_percent}
        detail={`${resources.memory_used_mb.toFixed(0)} / ${resources.memory_total_mb.toFixed(0)} MB`}
        stale={isStale}
        staleLabel={freshness.label}
      />

      <ResourceBar
        icon={HardDrive}
        label={t("disk")}
        percent={resources.disk_percent}
        detail={`${resources.disk_used_gb.toFixed(1)} / ${resources.disk_total_gb.toFixed(1)} GB`}
        stale={isStale}
        staleLabel={freshness.label}
      />

      {resources.temperature != null && (
        <div className="flex items-center gap-2 pt-2 border-t border-border-default">
          <Thermometer size={12} className="text-text-tertiary" />
          <span className="text-xs text-text-secondary">{t("temperature")}</span>
          <span
            className={cn(
              "text-xs font-mono ml-auto",
              resources.temperature >= 80
                ? "text-status-error"
                : resources.temperature >= 65
                  ? "text-status-warning"
                  : "text-text-primary"
            )}
          >
            {resources.temperature.toFixed(1)}°C
          </span>
        </div>
      )}
    </div>
  );
}
