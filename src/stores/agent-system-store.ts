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

  setStatus(status: AgentStatus) {
    set({ status });
  },

  async fetchStatus() {
    const { client, cloudMode } = useAgentConnectionStore.getState();
    if (cloudMode) return; // Cloud status arrives via reactive query
    if (!client) return;
    try {
      const status = await client.getStatus();
      set({ status });
    } catch {
      useAgentConnectionStore.setState({ connected: false, connectionError: "Lost connection to agent" });
      useAgentConnectionStore.getState().stopPolling();
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
      set({ services });
    } catch { /* silent */ }
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
        return { resources, cpuHistory, memoryHistory };
      });
    } catch { /* silent */ }
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
      set({ logs });
    } catch { /* silent */ }
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
    });
  },
}));
