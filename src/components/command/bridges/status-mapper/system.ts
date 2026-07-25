/**
 * @module command/bridges/status-mapper/system
 * @description Builds the System-tab update payload (resources,
 * cpu/memory history, service list, process metrics, logs) from the
 * already-mapped `AgentStatus` plus the raw Convex row. Pure.
 * @license GPL-3.0-only
 */

import {
  normalizeServiceStatus,
  type ServiceStatus,
} from "@/lib/agent/service-state";
import type { AgentStatus, ConfigError } from "@/lib/agent/types";

export interface MappedSystemUpdate {
  status: AgentStatus;
  lastUpdatedAt: number;
  stale: boolean;
  /** Utilisation and capacity readings are optional: a heartbeat that carried
   * no figure leaves the field undefined so the gauge reads unknown. */
  resources: {
    cpu_percent?: number;
    memory_percent?: number;
    memory_used_mb?: number;
    memory_total_mb?: number;
    memory_available_mb: number;
    memory_cache_mb: number;
    swap_total_mb: number;
    swap_used_mb: number;
    swap_percent: number;
    disk_percent?: number;
    disk_used_gb?: number;
    disk_total_gb?: number;
    temperature: number | null;
  };
  cpuHistory?: number[];
  memoryHistory?: number[];
  services?: Array<{
    name: unknown;
    status: ServiceStatus;
    pid: unknown;
    cpu_percent: number;
    memory_mb: number;
    uptime_seconds: number;
    category?: "core" | "hardware" | "suite" | "ondemand";
  }>;
  processCpuPercent?: number | null;
  processMemoryMb?: number | null;
  logs?: unknown[];
  /** Services whose config failed to parse on the agent. Always present (a
   * clean heartbeat clears any prior errors); empty when every config
   * loaded. */
  configErrors: ConfigError[];
}

// Map the cloud row's raw configErrors into typed entries, dropping anything
// malformed. The strict pushStatus validator already guarantees the shape, so
// this is defensive; an absent field maps to an empty list so a clean heartbeat
// clears any prior error banner.
function mapConfigErrors(raw: unknown): ConfigError[] {
  if (!Array.isArray(raw)) return [];
  const out: ConfigError[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.service === "string" && typeof row.error === "string") {
      out.push({ service: row.service, error: row.error });
    }
  }
  return out;
}

export function buildSystemUpdate(
  mapped: AgentStatus,
  cloudStatus: Record<string, unknown>,
  isDataFresh: boolean,
): MappedSystemUpdate {
  const update: MappedSystemUpdate = {
    status: mapped,
    lastUpdatedAt: cloudStatus.updatedAt as number,
    stale: !isDataFresh,
    configErrors: mapConfigErrors(cloudStatus.configErrors),
    resources: {
      cpu_percent: mapped.health.cpu_percent,
      memory_percent: mapped.health.memory_percent,
      memory_used_mb: cloudStatus.memoryUsedMb as number | undefined,
      memory_total_mb: cloudStatus.memoryTotalMb as number | undefined,
      memory_available_mb: (cloudStatus.memoryAvailableMb as number | undefined) ?? 0,
      memory_cache_mb: (cloudStatus.memoryCacheMb as number | undefined) ?? 0,
      swap_total_mb: (cloudStatus.swapTotalMb as number | undefined) ?? 0,
      swap_used_mb: (cloudStatus.swapUsedMb as number | undefined) ?? 0,
      swap_percent: (cloudStatus.swapPercent as number | undefined) ?? 0,
      disk_percent: mapped.health.disk_percent,
      disk_used_gb: cloudStatus.diskUsedGb as number | undefined,
      disk_total_gb: cloudStatus.diskTotalGb as number | undefined,
      temperature: mapped.health.temperature,
    },
  };

  const cpuHistory = cloudStatus.cpuHistory;
  if (Array.isArray(cpuHistory) && cpuHistory.length > 0) {
    update.cpuHistory = cpuHistory as number[];
  }
  const memoryHistory = cloudStatus.memoryHistory;
  if (Array.isArray(memoryHistory) && memoryHistory.length > 0) {
    update.memoryHistory = memoryHistory as number[];
  }

  const services = cloudStatus.services;
  if (Array.isArray(services)) {
    update.services = services.map((s: Record<string, unknown>) => {
      return {
        name: s.name,
        status: normalizeServiceStatus(s),
        pid: s.pid ?? null,
        cpu_percent: (s.cpuPercent as number | undefined) || 0,
        memory_mb: (s.memoryMb as number | undefined) || 0,
        uptime_seconds: (s.uptimeSeconds as number | undefined) ?? 0,
        category: s.category as "core" | "hardware" | "suite" | "ondemand" | undefined,
      };
    });
    update.processCpuPercent =
      (cloudStatus.processCpuPercent as number | null | undefined) ?? null;
    update.processMemoryMb =
      (cloudStatus.processMemoryMb as number | null | undefined) ?? null;
  }

  const logs = cloudStatus.logs;
  if (Array.isArray(logs)) {
    update.logs = logs;
  }

  return update;
}
