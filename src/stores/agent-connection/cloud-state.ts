/**
 * @module AgentConnectionCloudStateSlice
 * @description Cloud-mode connection state: device ID, MQTT readiness, last
 * cloud heartbeat timestamp, and the cloud command relay channel that the
 * MQTT bridge component listens on.
 * @license GPL-3.0-only
 */

import { useAgentSystemStore } from "../agent-system-store";
import { useLocalNodesStore } from "../local-nodes-store";
import { usePairingStore } from "../pairing-store";
import type {
  CloudStateSlice,
  AgentConnectionSliceCreator,
} from "./types";
import { MAX_CPU_HISTORY } from "./types";

/** Build a LAN URL from any cached pairing record (browser-local
 * ``local-nodes-store`` or Convex-mediated ``pairing-store``). Returns
 * null when no usable host is available; callers fall back to the
 * Convex heartbeat metadata.
 *
 * On HTTPS origins the browser blocks plain-HTTP fetches to a private
 * LAN host (mixed content). Returning null here lets the cloud-relay
 * cascade take over cleanly instead of surfacing a "Failed to fetch"
 * error from a doomed direct call. The LAN-direct optimisation is only
 * meaningful when the GCS page is served from an HTTP origin (e.g.
 * the local dev server, an Electron shell, or a self-hoster running
 * the GCS on the same LAN as the drone). */
export function resolveLanAgentUrl(deviceId: string): string | null {
  if (
    typeof window !== "undefined" &&
    window.location.protocol === "https:"
  ) {
    return null;
  }
  // local-nodes-store wins because it's the truth source for LAN-only
  // pairings (no Convex round-trip required) and stores ipv4 alongside
  // mdnsHost so non-mDNS browsers still resolve.
  const localNode = useLocalNodesStore
    .getState()
    .nodes.find((n) => n.deviceId === deviceId);
  if (localNode) {
    // hostname is already normalised to include scheme + port.
    if (localNode.hostname) return localNode.hostname;
    const host = localNode.mdnsHost || localNode.ipv4;
    if (host) return `http://${host}:8080`;
  }
  const pairedDrone = usePairingStore
    .getState()
    .pairedDrones.find((d) => d.deviceId === deviceId);
  if (pairedDrone) {
    const host = pairedDrone.mdnsHost || pairedDrone.lastIp;
    if (host) return `http://${host}:8080`;
  }
  return null;
}

/** Look up the paired API key for direct LAN HTTP calls. Prefers the
 * browser-local pairing record (LAN-only path) over the Convex-mediated
 * one. */
export function resolvePairedApiKey(deviceId: string): string | null {
  const localNode = useLocalNodesStore
    .getState()
    .nodes.find((n) => n.deviceId === deviceId);
  if (localNode?.apiKey) return localNode.apiKey;
  const pairedDrone = usePairingStore
    .getState()
    .pairedDrones.find((d) => d.deviceId === deviceId);
  return pairedDrone?.apiKey ?? null;
}

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
    const cpuHistory = [...systemStore.cpuHistory, status.health.cpu_percent];
    if (cpuHistory.length > MAX_CPU_HISTORY) cpuHistory.shift();
    const memoryHistory = [
      ...systemStore.memoryHistory,
      status.health.memory_percent,
    ];
    if (memoryHistory.length > MAX_CPU_HISTORY) memoryHistory.shift();
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
