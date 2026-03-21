"use client";

/**
 * @module TelemetryStrip
 * @description Compact vertical telemetry strip for the Drone Context Rail.
 * Shows agent health metrics from AgentStatus.health.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/agent-store";

export function TelemetryStrip() {
  const status = useAgentStore((s) => s.status);

  if (!status) return null;

  const health = status.health;

  return (
    <div className="rounded border border-border-default bg-bg-tertiary p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-tertiary">FC</span>
        <span
          className={cn(
            "text-[10px] font-mono font-medium",
            status.fc_connected ? "text-status-success" : "text-status-error"
          )}
        >
          {status.fc_connected ? "CONNECTED" : "DISCONNECTED"}
        </span>
      </div>
      {health && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-tertiary">CPU</span>
            <span className="text-[10px] font-mono text-text-secondary">
              {health.cpu_percent.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-tertiary">MEM</span>
            <span className="text-[10px] font-mono text-text-secondary">
              {health.memory_percent.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-text-tertiary">Disk</span>
            <span className="text-[10px] font-mono text-text-secondary">
              {health.disk_percent.toFixed(0)}%
            </span>
          </div>
          {health.temperature != null && (
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-tertiary">Temp</span>
              <span
                className={cn(
                  "text-[10px] font-mono",
                  health.temperature >= 80
                    ? "text-status-error"
                    : health.temperature >= 65
                      ? "text-status-warning"
                      : "text-text-secondary"
                )}
              >
                {health.temperature.toFixed(0)}°C
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
