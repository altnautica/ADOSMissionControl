/**
 * @module AgentConnectionCloudStateSlice
 * @description Cloud-mode connection state: device ID, MQTT readiness, last
 * cloud heartbeat timestamp, and the cloud command relay channel that the
 * MQTT bridge component listens on.
 * @license GPL-3.0-only
 */

import { useAgentSystemStore } from "../agent-system-store";
import { resolveLanAgentUrl, resolvePairedApiKey } from "@/lib/agent/resolve-agent";
import type {
  CloudStateSlice,
  AgentConnectionSliceCreator,
} from "./types";
import { MAX_CPU_HISTORY } from "./types";
import { appendHistorySample } from "@/lib/agent/history";

export const cloudStateSlice: AgentConnectionSliceCreator<CloudStateSlice> = (
  set,
  get,
) => ({
  cloudMode: false,
  cloudDeviceId: null,
  mqttConnected: false,
  lastCloudUpdate: null,

  connectCloud(deviceId) {
    get().stopPolling();
    // Pre-populate the LAN agent URL from the cached paired-drone record so
    // every downstream consumer (video-latency poll, clock-offset probe,
    // transport cascade, WHEP fallback) can attempt the agent directly
    // before relying on the Convex heartbeat. The Convex subscription stays
    // active as a fallback when the agent isn't reachable on the LAN.
    const lanUrl = resolveLanAgentUrl(deviceId);
    const lanKey = resolvePairedApiKey(deviceId);
    set({
      cloudMode: true,
      cloudDeviceId: deviceId,
      nodeDeviceId: deviceId,
      // Subscribing to the relay is not reaching the node. No client is built
      // here, no request has been answered, and the agent may have been dark
      // for hours. `connected` flips only when the status bridge sees a
      // heartbeat that is genuinely fresh; until then this is an attempt, and
      // the surfaces that gate on it read the node as not yet reached rather
      // than claiming a link that does not exist.
      connected: false,
      connectionError: null,
      agentUrl: lanUrl,
      apiKey: lanKey,
      client: null,
      mavlinkUrl: null,
      mavlinkPairRequired: false,
      consecutiveFailures: 0,
    });
    // The freshness clock is deliberately left alone. Clearing it would read as
    // "unknown", which every consumer treats as live-neutral: no dim, no stale
    // banner, no "last seen" label. On the reconnect path the node's last
    // readings are still on screen, so blanking the clock would repaint hours
    // old telemetry as current the instant the operator pressed the button.
    // Whatever the store already holds stays the truth until a heartbeat
    // replaces it, and a node with no readings at all was cleared on disconnect.
  },

  sendCloudCommand(command, args) {
    const { cloudDeviceId } = get();
    if (!cloudDeviceId) return;
    window.dispatchEvent(new CustomEvent("cloud-command", {
      detail: { deviceId: cloudDeviceId, command, args },
    }));
  },

  setCloudStatus(status, dataTimestamp) {
    const systemStore = useAgentSystemStore.getState();
    systemStore.setStatus(status);
    // A heartbeat that carried no reading contributes no history point — a
    // charted zero would read as a load measurement that never happened.
    const cpuHistory = appendHistorySample(
      systemStore.cpuHistory,
      status.health.cpu_percent,
      MAX_CPU_HISTORY,
    );
    const memoryHistory = appendHistorySample(
      systemStore.memoryHistory,
      status.health.memory_percent,
      MAX_CPU_HISTORY,
    );
    useAgentSystemStore.setState({ cpuHistory, memoryHistory });
    // Use the actual data timestamp (when the agent last pushed) instead of
    // Date.now(). This ensures the staleness watchdog in CloudStatusBridge
    // correctly detects offline agents whose Convex row is stale.
    set({ lastCloudUpdate: dataTimestamp ?? Date.now() });
  },

  setMqttConnected(connected) {
    set({ mqttConnected: connected });
  },
});
