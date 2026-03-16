"use client";

/**
 * @module VariableInspector
 * @description Right panel showing live drone state variables during script editing.
 * @license GPL-3.0-only
 */

import { useAgentStore } from "@/stores/agent-store";

interface VarEntry {
  name: string;
  value: string;
}

export function VariableInspector() {
  const status = useAgentStore((s) => s.status);
  const resources = useAgentStore((s) => s.resources);

  const vars: VarEntry[] = [];
  if (status) {
    vars.push(
      { name: "drone.fc_connected", value: String(status.fc_connected) },
      { name: "drone.board", value: status.board?.name ?? "Unknown" },
      { name: "drone.tier", value: String(status.board?.tier ?? "?") },
      { name: "drone.version", value: status.version },
      { name: "drone.uptime", value: `${status.uptime_seconds}s` },
    );
    if (status.health) {
      vars.push(
        { name: "health.cpu", value: `${status.health.cpu_percent.toFixed(1)}%` },
        { name: "health.mem", value: `${status.health.memory_percent.toFixed(1)}%` },
        { name: "health.disk", value: `${status.health.disk_percent.toFixed(1)}%` },
      );
    }
  }
  if (resources) {
    vars.push(
      { name: "system.cpu_percent", value: resources.cpu_percent.toFixed(1) },
      { name: "system.memory_mb", value: `${resources.memory_used_mb.toFixed(0)} / ${resources.memory_total_mb}` },
      { name: "system.disk_percent", value: resources.disk_percent.toFixed(1) },
    );
    if (resources.temperature !== null) {
      vars.push({ name: "system.temperature", value: `${resources.temperature.toFixed(1)}C` });
    }
  }

  return (
    <div className="w-[180px] border-l border-border-default bg-bg-secondary shrink-0 flex flex-col">
      <div className="px-3 py-2 border-b border-border-default">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          Variables
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {vars.map((v) => (
          <div key={v.name} className="flex items-center justify-between gap-1">
            <span className="text-[10px] text-text-tertiary truncate">{v.name}</span>
            <span className="text-[10px] font-mono text-accent-primary shrink-0">
              {v.value}
            </span>
          </div>
        ))}
        {vars.length === 0 && (
          <p className="text-[10px] text-text-tertiary text-center py-4">
            No data
          </p>
        )}
      </div>
    </div>
  );
}
