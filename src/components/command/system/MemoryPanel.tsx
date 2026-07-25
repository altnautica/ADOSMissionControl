"use client";

/**
 * @module MemoryPanel
 * @description Memory-usage breakdown for the System tab. Shows the system
 * RAM split (used / available / total) plus swap, a rolling history
 * sparkline, and a sorted per-service breakdown of where the RAM goes.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { MemoryStick, HardDrive, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ServiceInfo, SystemResources } from "@/lib/agent/types";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useFreshness } from "@/lib/agent/freshness";
import { MemorySparkline } from "../shared/MemorySparkline";
import { CollapsibleSection } from "./shared";

/**
 * Bar colour ramp keyed on a 0-100 utilisation percent. Mirrors the
 * ramp used by the system resource gauges so the System tab reads
 * consistently across panels.
 */
function barColor(percent: number | undefined, stale: boolean): string {
  if (percent == null) return "bg-text-tertiary/30";
  if (stale) return "bg-text-tertiary/60";
  if (percent >= 90) return "bg-status-error";
  if (percent >= 70) return "bg-status-warning";
  return "bg-accent-primary";
}

/** `percent` of `undefined` means the node reported no figure to compute one
 * from. That reads as "--" over an empty bar, not as 0%. */
function MemBar({
  label,
  percent,
  detail,
  stale,
}: {
  label: string;
  percent: number | undefined;
  detail: string;
  stale: boolean;
}) {
  const clamped = percent != null ? Math.max(0, Math.min(percent, 100)) : undefined;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-secondary truncate">{label}</span>
        <span
          className={cn(
            "text-xs font-mono shrink-0 ml-2",
            clamped == null || stale ? "text-text-tertiary" : "text-text-primary",
          )}
        >
          {clamped != null ? `${clamped.toFixed(1)}%` : "--"}
        </span>
      </div>
      <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", barColor(clamped, stale))}
          style={{ width: `${clamped ?? 0}%` }}
        />
      </div>
      <p className="text-[10px] text-text-tertiary font-mono">{detail}</p>
    </div>
  );
}

/** A megabyte figure, or "--" when the node did not report it. */
function mb(value: number | undefined): string {
  return value != null ? value.toFixed(0) : "--";
}

function SystemBreakdown({
  resources,
  stale,
}: {
  resources: SystemResources;
  stale: boolean;
}) {
  const total = resources.memory_total_mb;
  const used = resources.memory_used_mb;
  const available = resources.memory_available_mb;
  const cache = resources.memory_cache_mb;
  // Prefer the reported percentage, else derive one from used/total. When the
  // node reported neither there is nothing to derive from, so the figure stays
  // undefined and the bar reads unknown rather than 0% used.
  const usedPercent =
    resources.memory_percent != null && resources.memory_percent > 0
      ? resources.memory_percent
      : total != null && used != null && total > 0
        ? (used / total) * 100
        : undefined;

  const swapTotal = resources.swap_total_mb;
  const swapUsed = resources.swap_used_mb;
  const swapPercent =
    resources.swap_percent > 0
      ? resources.swap_percent
      : swapTotal > 0
        ? (swapUsed / swapTotal) * 100
        : 0;

  return (
    <div className="space-y-4">
      <MemBar
        label="Memory"
        percent={usedPercent}
        detail={`${mb(used)} USED / ${available.toFixed(0)} AVAIL / ${mb(total)} TOTAL MB`}
        stale={stale}
      />
      {cache > 0 && (
        <p className="text-[10px] text-text-tertiary font-mono">
          Cache + buffers: {cache.toFixed(0)} MB
        </p>
      )}
      {swapTotal > 0 && (
        <MemBar
          label="Swap"
          percent={swapPercent}
          detail={`${swapUsed.toFixed(0)} / ${swapTotal.toFixed(0)} MB`}
          stale={stale}
        />
      )}
    </div>
  );
}

interface ServiceMemRow {
  name: string;
  memoryMb: number;
  /** Share of total RAM. Undefined when the node reported no RAM total, since
   * a share of an unknown total cannot be computed. */
  percent: number | undefined;
}

function PerServiceBreakdown({
  services,
  totalMb,
  stale,
}: {
  services: ServiceInfo[];
  totalMb: number | undefined;
  stale: boolean;
}) {
  const rows = useMemo<ServiceMemRow[]>(() => {
    return services
      .filter((s) => s.status === "running" && (s.memory_mb ?? 0) > 0)
      .map((s) => ({
        name: s.name,
        memoryMb: s.memory_mb,
        percent:
          totalMb != null && totalMb > 0 ? (s.memory_mb / totalMb) * 100 : undefined,
      }))
      .sort((a, b) => b.memoryMb - a.memoryMb);
  }, [services, totalMb]);

  if (rows.length === 0) {
    return (
      <p className="text-xs text-text-tertiary py-3 text-center">
        Per-service memory needs agent accounting. Update the agent to
        report memory per service.
      </p>
    );
  }

  // Scale bars relative to the largest consumer so the smallest services
  // are still visible, while the percent-of-RAM label stays absolute.
  const maxMb = rows[0].memoryMb;

  return (
    <div className="space-y-2.5">
      {rows.map((row) => {
        const barWidth = maxMb > 0 ? (row.memoryMb / maxMb) * 100 : 0;
        return (
          <div key={row.name} className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-secondary font-mono truncate">
                {row.name}
              </span>
              <span className="text-xs font-mono text-text-primary shrink-0">
                {row.memoryMb.toFixed(0)} MB
                {row.percent != null && (
                  <span className="text-text-tertiary ml-1.5">
                    {row.percent.toFixed(1)}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  stale ? "bg-text-tertiary/60" : "bg-accent-secondary",
                )}
                style={{ width: `${Math.max(0, Math.min(barWidth, 100))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MemoryPanel() {
  const resources = useAgentSystemStore((s) => s.resources);
  const services = useAgentSystemStore((s) => s.services);
  const freshness = useFreshness();
  const stale = freshness.state !== "live" && freshness.state !== "unknown";

  if (!resources) return null;

  return (
    <CollapsibleSection title="Memory" icon={MemoryStick} defaultOpen={true}>
      <div className="space-y-5">
        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <HardDrive size={12} className="text-text-tertiary" />
            <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">
              System
            </span>
          </div>
          <SystemBreakdown resources={resources} stale={stale} />
        </div>

        <div>
          <MemorySparkline />
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-3">
            <Server size={12} className="text-text-tertiary" />
            <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold">
              Per service
            </span>
          </div>
          <PerServiceBreakdown
            services={services}
            totalMb={resources.memory_total_mb}
            stale={stale}
          />
        </div>
      </div>
    </CollapsibleSection>
  );
}
