/**
 * @module AgentStore
 * @description Zustand store for ADOS Drone Agent connection and state.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { AgentClient } from "@/lib/agent/client";
import type {
  AgentStatus,
  ServiceInfo,
  SystemResources,
  LogEntry,
  CommandResult,
  PeripheralInfo,
  ScriptInfo,
  ScriptRunResult,
  SuiteInfo,
  DroneNetEnrollment,
  NetworkPeer,
} from "@/lib/agent/types";

interface AgentStore {
  agentUrl: string | null;
  apiKey: string | null;
  connected: boolean;
  client: AgentClient | null;
  connectionError: string | null;

  status: AgentStatus | null;
  services: ServiceInfo[];
  resources: SystemResources | null;
  logs: LogEntry[];

  peripherals: PeripheralInfo[];
  scripts: ScriptInfo[];
  suites: SuiteInfo[];
  enrollment: DroneNetEnrollment | null;
  peers: NetworkPeer[];
  cpuHistory: number[];
  scriptOutput: ScriptRunResult | null;
  runningScript: string | null;

  pollInterval: ReturnType<typeof setInterval> | null;

  // Cloud mode state
  cloudMode: boolean;
  cloudDeviceId: string | null;
  mqttConnected: boolean;

  connect: (url: string, apiKey?: string | null) => Promise<void>;
  disconnect: () => void;
  setApiKey: (key: string | null) => void;
  fetchStatus: () => Promise<void>;
  fetchServices: () => Promise<void>;
  fetchResources: () => Promise<void>;
  fetchLogs: (level?: string) => Promise<void>;
  restartService: (name: string) => Promise<void>;
  sendCommand: (cmd: string, args?: unknown[]) => Promise<CommandResult | null>;
  startPolling: () => void;
  stopPolling: () => void;
  clear: () => void;

  // Cloud methods
  connectCloud: (deviceId: string) => void;
  sendCloudCommand: (command: string, args?: Record<string, unknown>) => void;
  setCloudStatus: (status: AgentStatus) => void;
  setMqttConnected: (connected: boolean) => void;

  fetchPeripherals: () => Promise<void>;
  scanPeripherals: () => Promise<void>;
  fetchScripts: () => Promise<void>;
  saveScript: (name: string, content: string, suite?: string) => Promise<ScriptInfo | null>;
  deleteScript: (id: string) => Promise<void>;
  runScript: (id: string) => Promise<void>;
  fetchSuites: () => Promise<void>;
  installSuite: (id: string) => Promise<void>;
  uninstallSuite: (id: string) => Promise<void>;
  activateSuite: (id: string) => Promise<void>;
  fetchEnrollment: () => Promise<void>;
  fetchPeers: () => Promise<void>;
}

const MAX_CPU_HISTORY = 60;

export const useAgentStore = create<AgentStore>((set, get) => ({
  agentUrl: null,
  apiKey: null,
  connected: false,
  client: null,
  connectionError: null,

  status: null,
  services: [],
  resources: null,
  logs: [],

  peripherals: [],
  scripts: [],
  suites: [],
  enrollment: null,
  peers: [],
  cpuHistory: [],
  scriptOutput: null,
  runningScript: null,

  pollInterval: null,

  // Cloud mode defaults
  cloudMode: false,
  cloudDeviceId: null,
  mqttConnected: false,

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
      set({ connected: true, status });
      // Fetch initial data immediately so tabs aren't empty for 3s
      get().fetchServices();
      get().fetchResources();
      get().fetchLogs();
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
      status: null,
      services: [],
      resources: null,
      logs: [],
      peripherals: [],
      scripts: [],
      suites: [],
      enrollment: null,
      peers: [],
      cpuHistory: [],
      scriptOutput: null,
      runningScript: null,
      cloudMode: false,
      cloudDeviceId: null,
      mqttConnected: false,
    });
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
    // The actual mutation call happens in the component layer (CloudStatusBridge)
    // since we need Convex context. Store dispatches intent via custom event.
    const { cloudDeviceId } = get();
    if (!cloudDeviceId) return;
    window.dispatchEvent(new CustomEvent("cloud-command", {
      detail: { deviceId: cloudDeviceId, command, args },
    }));
  },

  setCloudStatus(status: AgentStatus) {
    set((state) => {
      const cpuHistory = [...state.cpuHistory, status.health.cpu_percent];
      if (cpuHistory.length > MAX_CPU_HISTORY) cpuHistory.shift();
      return { status, cpuHistory };
    });
  },

  setMqttConnected(connected: boolean) {
    set({ mqttConnected: connected });
  },

  async fetchStatus() {
    const { client, cloudMode } = get();
    if (cloudMode) return; // Cloud status arrives via reactive query
    if (!client) return;
    try {
      const status = await client.getStatus();
      set({ status });
    } catch {
      set({ connected: false, connectionError: "Lost connection to agent" });
      get().stopPolling();
    }
  },

  async fetchServices() {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("get_services");
      return;
    }
    if (!client) return;
    try {
      const services = await client.getServices();
      set({ services });
    } catch { /* silent */ }
  },

  async fetchResources() {
    const { client, cloudMode } = get();
    if (cloudMode) return; // Cloud resources arrive via status push
    if (!client) return;
    try {
      const resources = await client.getSystemResources();
      set((state) => {
        const cpuHistory = [...state.cpuHistory, resources.cpu_percent];
        if (cpuHistory.length > MAX_CPU_HISTORY) cpuHistory.shift();
        return { resources, cpuHistory };
      });
    } catch { /* silent */ }
  },

  async fetchLogs(level?: string) {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("get_logs", { level, limit: 200 });
      return;
    }
    if (!client) return;
    try {
      const logs = await client.getLogs({ level, limit: 200 });
      set({ logs });
    } catch { /* silent */ }
  },

  async restartService(name: string) {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("restart_service", { name });
      return;
    }
    if (!client) return;
    try {
      await client.restartService(name);
      await get().fetchServices();
    } catch { /* silent */ }
  },

  async sendCommand(cmd: string, args?: unknown[]) {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("send_command", { cmd, args });
      return null;
    }
    if (!client) return null;
    try {
      return await client.sendCommand(cmd, args);
    } catch {
      return null;
    }
  },

  startPolling() {
    get().stopPolling();
    const interval = setInterval(() => {
      get().fetchStatus();
      get().fetchServices();
      get().fetchResources();
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

  // ── Peripherals ─────────────────────────────────────────

  async fetchPeripherals() {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("get_peripherals");
      return;
    }
    if (!client) return;
    try {
      const peripherals = await client.getPeripherals();
      set({ peripherals });
    } catch { /* silent */ }
  },

  async scanPeripherals() {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("scan_peripherals");
      return;
    }
    if (!client) return;
    try {
      const peripherals = await client.scanPeripherals();
      set({ peripherals });
    } catch { /* silent */ }
  },

  // ── Scripts ─────────────────────────────────────────────

  async fetchScripts() {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("get_scripts");
      return;
    }
    if (!client) return;
    try {
      const scripts = await client.getScripts();
      set({ scripts });
    } catch { /* silent */ }
  },

  async saveScript(name: string, content: string, suite?: string) {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("save_script", { name, content, suite });
      return null;
    }
    if (!client) return null;
    try {
      const script = await client.saveScript(name, content, suite);
      await get().fetchScripts();
      return script;
    } catch {
      return null;
    }
  },

  async deleteScript(id: string) {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("delete_script", { id });
      return;
    }
    if (!client) return;
    try {
      await client.deleteScript(id);
      await get().fetchScripts();
    } catch { /* silent */ }
  },

  async runScript(id: string) {
    const { client, cloudMode } = get();
    if (cloudMode) {
      set({ runningScript: id, scriptOutput: null });
      get().sendCloudCommand("run_script", { id });
      return;
    }
    if (!client) return;
    set({ runningScript: id, scriptOutput: null });
    try {
      const result = await client.runScript(id);
      set({ scriptOutput: result, runningScript: null });
    } catch {
      set({
        scriptOutput: { stdout: "", stderr: "Failed to execute script", exitCode: 1, durationMs: 0 },
        runningScript: null,
      });
    }
  },

  // ── Suites ──────────────────────────────────────────────

  async fetchSuites() {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("get_suites");
      return;
    }
    if (!client) return;
    try {
      const suites = await client.getSuites();
      set({ suites });
    } catch { /* silent */ }
  },

  async installSuite(id: string) {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("install_suite", { id });
      return;
    }
    if (!client) return;
    try {
      await client.installSuite(id);
      await get().fetchSuites();
    } catch { /* silent */ }
  },

  async uninstallSuite(id: string) {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("uninstall_suite", { id });
      return;
    }
    if (!client) return;
    try {
      await client.uninstallSuite(id);
      await get().fetchSuites();
    } catch { /* silent */ }
  },

  async activateSuite(id: string) {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("activate_suite", { id });
      return;
    }
    if (!client) return;
    try {
      await client.activateSuite(id);
      await get().fetchSuites();
    } catch { /* silent */ }
  },

  // ── Fleet ───────────────────────────────────────────────

  async fetchEnrollment() {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("get_enrollment");
      return;
    }
    if (!client) return;
    try {
      const enrollment = await client.getEnrollment();
      set({ enrollment });
    } catch { /* silent */ }
  },

  async fetchPeers() {
    const { client, cloudMode } = get();
    if (cloudMode) {
      get().sendCloudCommand("get_peers");
      return;
    }
    if (!client) return;
    try {
      const peers = await client.getPeers();
      set({ peers });
    } catch { /* silent */ }
  },
}));
