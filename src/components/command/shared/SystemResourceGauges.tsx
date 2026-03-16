"use client";

import { Cpu, MemoryStick, HardDrive, Thermometer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SystemResources } from "@/lib/agent/types";

interface SystemResourceGaugesProps {
  resources: SystemResources;
}

function barColor(percent: number): string {
  if (percent >= 90) return "bg-status-error";
  if (percent >= 70) return "bg-status-warning";
  return "bg-accent-primary";
}

function ResourceBar({
  icon: Icon,
  label,
  percent,
  detail,
}: {
  icon: typeof Cpu;
  label: string;
  percent: number;
  detail: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon size={12} className="text-text-tertiary" />
          <span className="text-xs text-text-secondary">{label}</span>
        </div>
        <span className="text-xs text-text-primary font-mono">
          {percent.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor(percent))}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
      <p className="text-[10px] text-text-tertiary">{detail}</p>
    </div>
  );
}

export function SystemResourceGauges({ resources }: SystemResourceGaugesProps) {
  return (
    <div className="border border-border-default rounded-lg p-4 space-y-4">
      <h3 className="text-sm font-medium text-text-primary">System Resources</h3>

      <ResourceBar
        icon={Cpu}
        label="CPU"
        percent={resources.cpu_percent}
        detail={`${resources.cpu_percent.toFixed(1)}% utilization`}
      />

      <ResourceBar
        icon={MemoryStick}
        label="Memory"
        percent={resources.memory_percent}
        detail={`${resources.memory_used_mb.toFixed(0)} / ${resources.memory_total_mb.toFixed(0)} MB`}
      />

      <ResourceBar
        icon={HardDrive}
        label="Disk"
        percent={resources.disk_percent}
        detail={`${resources.disk_used_gb.toFixed(1)} / ${resources.disk_total_gb.toFixed(1)} GB`}
      />

      {resources.temperature != null && (
        <div className="flex items-center gap-2 pt-2 border-t border-border-default">
          <Thermometer size={12} className="text-text-tertiary" />
          <span className="text-xs text-text-secondary">Temperature</span>
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
