/**
 * @module AgentConnectionStore
 * @description Zustand store for ADOS Drone Agent connection lifecycle.
 * Manages connection state, client instance, cloud mode, and polling.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { AgentClient } from "@/lib/agent/client";
import type { AgentStatus } from "@/lib/agent/types";
import { useAgentSystemStore } from "./agent-system-store";

interface AgentConnectionState {
  agentUrl: string | null;
  apiKey: string | null;
  connected: boolean;
  client: AgentClient | null;
  connectionError: string | null;
  pollInterval: ReturnType<typeof setInterval> | null;

  // Cloud mode state
  cloudMode: boolean;
  cloudDeviceId: string | null;
  mqttConnected: boolean;
  lastCloudUpdate: number | null;
}

interface AgentConnectionActions {
  connect: (url: string, apiKey?: string | null) => Promise<void>;
  disconnect: () => void;
  setApiKey: (key: string | null) => void;
  startPolling: () => void;
  stopPolling: () => void;
  clear: () => void;

  // Cloud methods
  connectCloud: (deviceId: string) => void;
  sendCloudCommand: (command: string, args?: Record<string, unknown>) => void;
  setCloudStatus: (status: AgentStatus) => void;
  setMqttConnected: (connected: boolean) => void;
}

export type AgentConnectionStore = AgentConnectionState & AgentConnectionActions;

const MAX_CPU_HISTORY = 60;

export const useAgentConnectionStore = create<AgentConnectionStore>((set, get) => ({
  agentUrl: null,
  apiKey: null,
  connected: false,
  client: null,
  connectionError: null,
  pollInterval: null,

  // Cloud mode defaults
  cloudMode: false,
  cloudDeviceId: null,
  mqttConnected: false,
  lastCloudUpdate: null,

  setApiKey(key: string | null) {
    set({ apiKey: key });
  },

  async connect(url: string, apiKey?: string | null) {
    let client: AgentClient;
    const resolvedKey = apiKey ?? get().apiKey;
    if (url === "mock://demo") {
      const { MockAgentClient } = await import("@/mock/mock-agent");
      client = new MockAgentClient() as unknown as AgentClient;
    } else {
      client = new AgentClient(url, resolvedKey);
    }
    set({ agentUrl: url, apiKey: resolvedKey, client, connectionError: null });
    try {
      const status = await client.getStatus();
      set({ connected: true });
      useAgentSystemStore.getState().setStatus(status);
      // Fetch initial data immediately so tabs aren't empty for 3s
      useAgentSystemStore.getState().fetchServices();
      useAgentSystemStore.getState().fetchResources();
      useAgentSystemStore.getState().fetchLogs();
      get().startPolling();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      set({ connected: false, connectionError: msg, client: null, agentUrl: null });
    }
  },

  disconnect() {
    get().stopPolling();
    set({
      connected: false,
      client: null,
      agentUrl: null,
      apiKey: null,
      connectionError: null,
      cloudMode: false,
      cloudDeviceId: null,
      mqttConnected: false,
      lastCloudUpdate: null,
      pollInterval: null,
    });
    // Clear all other stores
    useAgentSystemStore.getState().clear();
    // Import lazily to avoid circular dependency at module load
    const { useAgentPeripheralsStore } = require("./agent-peripherals-store");
    const { useAgentScriptsStore } = require("./agent-scripts-store");
    useAgentPeripheralsStore.getState().clear();
    useAgentScriptsStore.getState().clear();
  },

  connectCloud(deviceId: string) {
    get().stopPolling();
    set({
      cloudMode: true,
      cloudDeviceId: deviceId,
      connected: true,
      connectionError: null,
      agentUrl: null,
      client: null,
    });
  },

  sendCloudCommand(command: string, args?: Record<string, unknown>) {
    const { cloudDeviceId } = get();
    if (!cloudDeviceId) return;
    window.dispatchEvent(new CustomEvent("cloud-command", {
      detail: { deviceId: cloudDeviceId, command, args },
    }));
  },

  setCloudStatus(status: AgentStatus) {
    const systemStore = useAgentSystemStore.getState();
    systemStore.setStatus(status);
    const cpuHistory = [...systemStore.cpuHistory, status.health.cpu_percent];
    if (cpuHistory.length > MAX_CPU_HISTORY) cpuHistory.shift();
    const memoryHistory = [...systemStore.memoryHistory, status.health.memory_percent];
    if (memoryHistory.length > MAX_CPU_HISTORY) memoryHistory.shift();
    useAgentSystemStore.setState({ cpuHistory, memoryHistory });
    set({ lastCloudUpdate: Date.now() });
  },

  setMqttConnected(connected: boolean) {
    set({ mqttConnected: connected });
  },

  startPolling() {
    get().stopPolling();
    const interval = setInterval(() => {
      useAgentSystemStore.getState().fetchStatus();
      useAgentSystemStore.getState().fetchServices();
      useAgentSystemStore.getState().fetchResources();
    }, 3000);
    set({ pollInterval: interval });
  },

  stopPolling() {
    const { pollInterval } = get();
    if (pollInterval) {
      clearInterval(pollInterval);
      set({ pollInterval: null });
    }
  },

  clear() {
    get().disconnect();
  },
}));
