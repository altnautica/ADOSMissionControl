/**
 * @module AgentSystemStore
 * @description Zustand store for ADOS Drone Agent system monitoring.
 * Manages status, services, resources, CPU/memory history, and logs.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type {
  AgentStatus,
  ServiceInfo,
  SystemResources,
  LogEntry,
  CommandResult,
  ConfigError,
} from "@/lib/agent/types";
import { appendHistorySample } from "@/lib/agent/history";
import { useAgentConnectionStore } from "./agent-connection-store";

const MAX_CPU_HISTORY = 60;

interface AgentSystemState {
  status: AgentStatus | null;
  services: ServiceInfo[];
  resources: SystemResources | null;
  logs: LogEntry[];
  cpuHistory: number[];
  memoryHistory: number[];
  /** Rolling GPU-utilisation ring for the focused workstation/compute node,
   * appended on each compute-status poll. Mirrors `cpuHistory` so the GPU
   * sparkline reads the same store + freshness model as CPU/memory. Empty on
   * any node that does not report a GPU. */
  gpuHistory: number[];
  processCpuPercent: number | null;
  processMemoryMb: number | null;
  /** Services whose config file failed to parse on the agent (it ran on
   * defaults). Empty when every config loaded cleanly. Drives the red
   * config-error panel on the Health surface. */
  configErrors: ConfigError[];
  /** Wall-clock ms of the last time any agent data was written to this store. */
  lastUpdatedAt: number | null;
  /** True when the freshness watchdog has flagged the agent as not updating. */
  stale: boolean;
}

interface AgentSystemActions {
  setStatus: (status: AgentStatus) => void;
  fetchStatus: () => Promise<void>;
  fetchServices: () => Promise<void>;
  fetchResources: () => Promise<void>;
  fetchLogs: (level?: string) => Promise<void>;
  /** Append one GPU-utilisation sample to `gpuHistory` (capped, ring-buffered).
   * Non-finite values are ignored. Fed by the compute-status poll. */
  pushGpuUtilization: (pct: number) => void;
  restartService: (name: string) => Promise<void>;
  sendCommand: (cmd: string, args?: unknown[]) => Promise<CommandResult | null>;
  clear: () => void;
}

export type AgentSystemStore = AgentSystemState & AgentSystemActions;

export const useAgentSystemStore = create<AgentSystemStore>((set, get) => ({
  status: null,
  services: [],
  resources: null,
  logs: [],
  cpuHistory: [],
  memoryHistory: [],
  gpuHistory: [],
  processCpuPercent: null,
  processMemoryMb: null,
  configErrors: [],
  lastUpdatedAt: null,
  stale: false,

  setStatus(status: AgentStatus) {
    set({ status, lastUpdatedAt: Date.now(), stale: false });
  },

  async fetchStatus() {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) return; // Cloud status arrives via reactive query
    if (!client) return;
    try {
      const status = await client.getStatus();
      set({ status, lastUpdatedAt: Date.now(), stale: false });
      useAgentConnectionStore.getState().noteFetchSuccess();
    } catch {
      useAgentConnectionStore.getState().noteFetchFailure();
    }
  },

  async fetchServices() {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("get_services");
      return;
    }
    if (!client) return;
    try {
      const agentUptime = get().status?.uptime_seconds ?? 0;
      const services = await client.getServices(agentUptime);
      set({ services, lastUpdatedAt: Date.now(), stale: false });
      useAgentConnectionStore.getState().noteFetchSuccess();
    } catch {
      useAgentConnectionStore.getState().noteFetchFailure();
    }
  },

  async fetchResources() {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) return; // Cloud resources arrive via status push
    if (!client) return;
    try {
      const resources = await client.getSystemResources();
      set((state) => {
        // A poll that returned no reading contributes no history point, so the
        // chart never shows a dip the node did not report.
        const cpuHistory = appendHistorySample(
          state.cpuHistory,
          resources.cpu_percent,
          MAX_CPU_HISTORY,
        );
        const memoryHistory = appendHistorySample(
          state.memoryHistory,
          resources.memory_percent,
          MAX_CPU_HISTORY,
        );
        return { resources, cpuHistory, memoryHistory, lastUpdatedAt: Date.now(), stale: false };
      });
      useAgentConnectionStore.getState().noteFetchSuccess();
    } catch {
      useAgentConnectionStore.getState().noteFetchFailure();
    }
  },

  async fetchLogs(level?: string) {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("get_logs", { level, limit: 200 });
      return;
    }
    if (!client) return;
    // Prefer the durable store reader (three-tier: LAN-direct → proxy →
    // legacy). Its legacy tier transparently maps the old /api/logs shape,
    // so a pre-store agent still answers. Fall back to the direct getLogs
    // call only if the logging surface is entirely absent (e.g. a mock that
    // predates it).
    try {
      if (client.logging) {
        const envelope = await client.logging.query({ level, limit: 200 });
        // Newest-first from the store; the viewer expects chronological.
        const logs: LogEntry[] = [...envelope.data]
          .reverse()
          .map((row) => ({
            timestamp: row.ts,
            level: row.level,
            service: row.source,
            message: row.message,
          }));
        set({ logs, lastUpdatedAt: Date.now(), stale: false });
        useAgentConnectionStore.getState().noteFetchSuccess();
        return;
      }
      const logs = await client.getLogs({ level, limit: 200 });
      set({ logs, lastUpdatedAt: Date.now(), stale: false });
      useAgentConnectionStore.getState().noteFetchSuccess();
    } catch { /* silent — logs are best-effort */ }
  },

  pushGpuUtilization(pct: number) {
    if (!Number.isFinite(pct)) return;
    set((state) => {
      const gpuHistory = [...state.gpuHistory, pct];
      if (gpuHistory.length > MAX_CPU_HISTORY) gpuHistory.shift();
      return { gpuHistory };
    });
  },

  async restartService(name: string) {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("restart_service", { name });
      return;
    }
    if (!client) return;
    try {
      await client.restartService(name);
      await get().fetchServices();
    } catch { /* silent */ }
  },

  async sendCommand(cmd: string, args?: unknown[]) {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) {
      useAgentConnectionStore.getState().sendCloudCommand("send_command", { cmd, args });
      return null;
    }
    if (!client) return null;
    try {
      return await client.sendCommand(cmd, args);
    } catch {
      return null;
    }
  },

  clear() {
    set({
      status: null,
      services: [],
      resources: null,
      logs: [],
      cpuHistory: [],
      memoryHistory: [],
      gpuHistory: [],
      processCpuPercent: null,
      processMemoryMb: null,
      configErrors: [],
      lastUpdatedAt: null,
      stale: false,
    });
  },
}));
