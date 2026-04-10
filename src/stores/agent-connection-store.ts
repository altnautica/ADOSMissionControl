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
import { useAgentPeripheralsStore } from "./agent-peripherals-store";
import { useAgentScriptsStore } from "./agent-scripts-store";
import { useVideoStore } from "./video-store";
import { useAgentCapabilitiesStore } from "./agent-capabilities-store";

interface AgentConnectionState {
  agentUrl: string | null;
  apiKey: string | null;
  connected: boolean;
  client: AgentClient | null;
  connectionError: string | null;
  pollInterval: ReturnType<typeof setInterval> | null;
  /** Consecutive poll failures. Used by the local-mode staleness cascade. */
  consecutiveFailures: number;

  // Cloud mode state
  cloudMode: boolean;
  cloudDeviceId: string | null;
  mqttConnected: boolean;
  lastCloudUpdate: number | null;

  // MAVLink WebSocket URL (set from agent heartbeat or direct connection)
  mavlinkUrl: string | null;
}

interface AgentConnectionActions {
  connect: (url: string, apiKey?: string | null) => Promise<void>;
  disconnect: () => void;
  setApiKey: (key: string | null) => void;
  startPolling: () => void;
  stopPolling: () => void;
  clear: () => void;

  // Staleness cascade (local-mode polling)
  noteFetchSuccess: () => void;
  noteFetchFailure: () => void;

  // Cloud methods
  connectCloud: (deviceId: string) => void;
  sendCloudCommand: (command: string, args?: Record<string, unknown>) => void;
  setCloudStatus: (status: AgentStatus) => void;
  setMqttConnected: (connected: boolean) => void;

  // MAVLink URL
  setMavlinkUrl: (url: string | null) => void;
}

export type AgentConnectionStore = AgentConnectionState & AgentConnectionActions;

const MAX_CPU_HISTORY = 60;

// Module-level cleanup function for tab visibility listener. Lives outside the
// store because Zustand's strict typing doesn't allow ad-hoc extra fields.
let _visibilityCleanup: (() => void) | undefined;

export const useAgentConnectionStore = create<AgentConnectionStore>((set, get) => ({
  agentUrl: null,
  apiKey: null,
  connected: false,
  client: null,
  connectionError: null,
  pollInterval: null,
  consecutiveFailures: 0,

  // Cloud mode defaults
  cloudMode: false,
  cloudDeviceId: null,
  mqttConnected: false,
  lastCloudUpdate: null,
  mavlinkUrl: null,

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
      // Derive MAVLink WebSocket URL from agent REST URL
      // Agent REST is on :8080, MAVLink WebSocket is on :8765
      try {
        const agentUrlObj = new URL(url);
        const mavWsUrl = `ws://${agentUrlObj.hostname}:8765/`;
        set({ mavlinkUrl: mavWsUrl });
      } catch { /* ignore invalid URL */ }
      useAgentSystemStore.getState().setStatus(status);
      // Fetch initial data immediately so tabs aren't empty for 3s
      useAgentSystemStore.getState().fetchServices();
      useAgentSystemStore.getState().fetchResources();
      useAgentSystemStore.getState().fetchLogs();
      // Populate capabilities (mock or real)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyClient = client as any;
      if (typeof anyClient.getCapabilities === "function") {
        try {
          const caps = await anyClient.getCapabilities();
          if (caps) useAgentCapabilitiesStore.getState().setCapabilities(caps);
        } catch { /* capabilities optional */ }
      }
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
      mavlinkUrl: null,
      consecutiveFailures: 0,
    });
    // Clear all other stores
    useAgentSystemStore.getState().clear();
    useAgentPeripheralsStore.getState().clear();
    useAgentScriptsStore.getState().clear();
  },

  noteFetchSuccess() {
    const { consecutiveFailures, connected, connectionError } = get();
    const patch: Partial<AgentConnectionState> = {};
    if (consecutiveFailures !== 0) patch.consecutiveFailures = 0;
    if (!connected) patch.connected = true;
    if (connectionError) patch.connectionError = null;
    if (Object.keys(patch).length > 0) set(patch);
    // Fetch succeeded — system store stale flag is cleared by the fetcher itself.
  },

  noteFetchFailure() {
    const next = get().consecutiveFailures + 1;
    set({ consecutiveFailures: next });
    // After 3 consecutive failures (~9s at 3s poll), mark data stale but keep
    // last-known values visible. After 6 (~18s), flip the header to offline.
    if (next >= 3) {
      if (!useAgentSystemStore.getState().stale) {
        useAgentSystemStore.setState({ stale: true });
      }
    }
    if (next >= 6) {
      if (get().connected) {
        set({
          connected: false,
          connectionError: "Lost connection to agent",
        });
      }
    }
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
      mavlinkUrl: null,
      // Give the watchdog a grace period so it doesn't immediately re-flip
      // the header to offline against the old stale timestamp.
      lastCloudUpdate: Date.now(),
      consecutiveFailures: 0,
    });
    // Reset the freshness clock to "unknown" so the UI stops showing
    // stale/offline treatment while we wait for the first fresh heartbeat.
    // getFreshness(null) returns state: "unknown" which every consumer
    // treats as live-neutral (no dim, no banner, no "last seen Xm ago" chip).
    // The next heartbeat (or the watchdog at t+STALE_THRESHOLD_MS) will
    // reinstate the correct state.
    useAgentSystemStore.setState({ lastUpdatedAt: null, stale: false });
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

  setMavlinkUrl(url: string | null) {
    set({ mavlinkUrl: url });
  },

  startPolling() {
    get().stopPolling();

    // Track whether the consolidated endpoint is available (agent v0.3.19+).
    // Once confirmed, skip the 4-request fallback path.
    let useFullEndpoint: boolean | null = null; // null = untried

    const poll = async () => {
      // Pause polling when browser tab is hidden to save bandwidth/battery.
      if (typeof document !== "undefined" && document.hidden) return;

      const client = get().client;
      if (!client) return;

      try {
        // Try consolidated endpoint first (1 request instead of 4).
        if (useFullEndpoint !== false && typeof client.getFullStatus === "function") {
          const full = await client.getFullStatus();
          if (full) {
            useFullEndpoint = true;
            // Map consolidated response to the same stores as the 4-endpoint path.
            const status = {
              version: full.version,
              uptime_seconds: full.uptime_seconds,
              board: full.board,
              health: full.health,
              fc_connected: full.fc_connected,
              fc_port: full.fc_port,
              fc_baud: full.fc_baud,
            };
            useAgentSystemStore.getState().setStatus(status as AgentStatus);
            if (full.services) {
              // Map service state field name for compatibility
              const mapped = full.services.map((s: { name: string; state: string; task_done: boolean; uptimeSeconds: number }) => ({
                ...s,
                status: s.state,
              }));
              useAgentSystemStore.setState({ services: mapped as never[] });
            }
            if (full.resources) {
              useAgentSystemStore.setState({
                resources: full.resources as never,
                lastUpdatedAt: Date.now(),
                stale: false,
              });
            }
            if (full.video) {
              useVideoStore.getState().setAgentVideoStatus(
                full.video.state,
                full.video.whep_url,
              );
            }
            // Populate capabilities store from consolidated response
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const fullAny = full as any;
            if (fullAny.capabilities) {
              useAgentCapabilitiesStore.getState().setCapabilities(fullAny.capabilities);
            }
            get().noteFetchSuccess();
            return;
          }
          // 404 or null = agent doesn't support it
          useFullEndpoint = false;
        }

        // Fallback: parallel requests for older agents
        await Promise.all([
          useAgentSystemStore.getState().fetchStatus(),
          useAgentSystemStore.getState().fetchServices(),
          useAgentSystemStore.getState().fetchResources(),
        ]);

        // Video status (may not exist on all agents)
        if (typeof client.getVideoStatus === "function") {
          client.getVideoStatus().then((video) => {
            if (video) {
              const deps = video.dependencies
                ? Object.fromEntries(
                    Object.entries(video.dependencies).map(([k, v]) => [k, { found: v.found }])
                  )
                : undefined;
              useVideoStore.getState().setAgentVideoStatus(video.state, video.whep_url, deps);
            }
          }).catch(() => {});
        }
        get().noteFetchSuccess();
      } catch {
        get().noteFetchFailure();
      }
    };

    // Run first poll immediately, then every 3s
    poll();
    const interval = setInterval(poll, 3000);
    set({ pollInterval: interval });

    // Pause/resume on tab visibility change
    if (typeof document !== "undefined") {
      const onVisibility = () => {
        if (!document.hidden) {
          // Tab became visible: poll immediately for fresh data
          poll();
        }
      };
      document.addEventListener("visibilitychange", onVisibility);
      // Store the cleanup function
      _visibilityCleanup = () => {
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }
  },

  stopPolling() {
    const { pollInterval } = get();
    if (pollInterval) {
      clearInterval(pollInterval);
      set({ pollInterval: null });
    }
    // Clean up visibility listener
    if (_visibilityCleanup) {
      _visibilityCleanup();
      _visibilityCleanup = undefined;
    }
  },

  clear() {
    get().disconnect();
  },
}));
