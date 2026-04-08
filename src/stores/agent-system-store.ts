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
} from "@/lib/agent/types";
import { useAgentConnectionStore } from "./agent-connection-store";

const MAX_CPU_HISTORY = 60;

interface AgentSystemState {
  status: AgentStatus | null;
  services: ServiceInfo[];
  resources: SystemResources | null;
  logs: LogEntry[];
  cpuHistory: number[];
  memoryHistory: number[];
  processCpuPercent: number | null;
  processMemoryMb: number | null;
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
  processCpuPercent: null,
  processMemoryMb: null,
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
        const cpuHistory = [...state.cpuHistory, resources.cpu_percent];
        if (cpuHistory.length > MAX_CPU_HISTORY) cpuHistory.shift();
        const memoryHistory = [...state.memoryHistory, resources.memory_percent];
        if (memoryHistory.length > MAX_CPU_HISTORY) memoryHistory.shift();
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
    try {
      const logs = await client.getLogs({ level, limit: 200 });
      set({ logs, lastUpdatedAt: Date.now(), stale: false });
      useAgentConnectionStore.getState().noteFetchSuccess();
    } catch { /* silent — logs are best-effort */ }
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
      processCpuPercent: null,
      processMemoryMb: null,
      lastUpdatedAt: null,
      stale: false,
    });
  },
}));
