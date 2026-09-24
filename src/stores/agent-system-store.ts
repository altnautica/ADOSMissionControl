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
import { agentConnectionLink, isCurrentAgentClient } from "./agent-connection/link";

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
  /** Fetch and store the agent's status. Resolves `true` when a reading
   * landed, `false` when the request failed or no request was made (cloud
   * mode, no client). The poll loop derives its success/failure verdict from
   * these, so a swallowed error must never read as a success. */
  fetchStatus: () => Promise<boolean>;
  /** @see fetchStatus */
  fetchServices: () => Promise<boolean>;
  /** @see fetchStatus */
  fetchResources: () => Promise<boolean>;
  fetchLogs: (level?: string) => Promise<void>;
  /** Append one GPU-utilisation sample to `gpuHistory` (capped, ring-buffered).
   * Non-finite values are ignored. Fed by the compute-status poll. */
  pushGpuUtilization: (pct: number) => void;
  /** Restart one agent unit. Resolves with the agent's confirmation, or null
   * when the request was queued over the cloud relay (its outcome arrives as
   * a command result). Rejects with the agent's reason on a failed, refused
   * or unconfirmed restart. */
  restartService: (name: string) => Promise<string | null>;
  /** Restart the supervisor, cycling every agent service. Needs a direct
   * client; rejects with the agent's reason when it cannot be scheduled. */
  restartAll: () => Promise<string>;
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
    const link = agentConnectionLink();
    if (!link) return false;
    const { client, cloudMode } = link;
    if (cloudMode) return false; // Cloud status arrives via reactive query
    if (!client) return false;
    try {
      const status = await client.getStatus();
      if (!isCurrentAgentClient(client)) return false;
      set({ status, lastUpdatedAt: Date.now(), stale: false });
      link.noteFetchSuccess();
      return true;
    } catch {
      if (isCurrentAgentClient(client)) link.noteFetchFailure();
      return false;
    }
  },

  async fetchServices() {
    const link = agentConnectionLink();
    if (!link) return false;
    const { client, cloudMode } = link;
    if (cloudMode) {
      // A queued cloud command is a dispatch, not an answer, so it is not a
      // reading this poll can claim.
      link.sendCloudCommand("get_services");
      return false;
    }
    if (!client) return false;
    try {
      const services = await client.getServices();
      if (!isCurrentAgentClient(client)) return false;
      set({ services, lastUpdatedAt: Date.now(), stale: false });
      link.noteFetchSuccess();
      return true;
    } catch {
      if (isCurrentAgentClient(client)) link.noteFetchFailure();
      return false;
    }
  },

  async fetchResources() {
    const link = agentConnectionLink();
    if (!link) return false;
    const { client, cloudMode } = link;
    if (cloudMode) return false; // Cloud resources arrive via status push
    if (!client) return false;
    try {
      const resources = await client.getSystemResources();
      if (!isCurrentAgentClient(client)) return false;
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
      link.noteFetchSuccess();
      return true;
    } catch {
      if (isCurrentAgentClient(client)) link.noteFetchFailure();
      return false;
    }
  },

  async fetchLogs(level?: string) {
    const link = agentConnectionLink();
    if (!link) return;
    const { client, cloudMode } = link;
    if (cloudMode) {
      link.sendCloudCommand("get_logs", { level, limit: 200 });
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
        if (!isCurrentAgentClient(client)) return;
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
        link.noteFetchSuccess();
        return;
      }
      const logs = await client.getLogs({ level, limit: 200 });
      if (!isCurrentAgentClient(client)) return;
      set({ logs, lastUpdatedAt: Date.now(), stale: false });
      link.noteFetchSuccess();
    } catch { /* silent — logs are best-effort */ }
  },

  pushGpuUtilization(pct: number) {
    // Same bounded-append helper as cpuHistory / memoryHistory: one path for
    // all three series so a non-finite reading is skipped rather than charted
    // as a dip, and the cap cannot drift between them.
    set((state) => {
      const gpuHistory = appendHistorySample(
        state.gpuHistory,
        pct,
        MAX_CPU_HISTORY,
      );
      return gpuHistory === state.gpuHistory ? state : { gpuHistory };
    });
  },

  async restartService(name: string) {
    const link = agentConnectionLink();
    if (!link) throw new Error("Agent not connected");
    const { client, cloudMode } = link;
    if (cloudMode) {
      link.sendCloudCommand("restart_service", { name });
      return null;
    }
    if (!client) throw new Error("Agent not connected");
    try {
      const res = await client.restartService(name);
      return res.message;
    } finally {
      // A failed restart can still leave the unit in a new state.
      void get().fetchServices();
    }
  },

  async restartAll() {
    const link = agentConnectionLink();
    if (!link) throw new Error("Agent not connected");
    const { client, cloudMode } = link;
    if (cloudMode || !client) throw new Error("Agent not connected");
    const res = await client.restartSupervisor();
    return res.message;
  },

  async sendCommand(cmd: string, args?: unknown[]) {
    const link = agentConnectionLink();
    if (!link) return null;
    const { client, cloudMode } = link;
    if (cloudMode) {
      link.sendCloudCommand("send_command", { cmd, args });
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
