"use client";

/**
 * @module plugins/node-agent-reach
 * @description How the GCS reaches one node's agent for its plugins, whatever
 * the page origin: the node's own LAN address, or its ground station's WFB
 * relay-proxy when the drone has no address of its own. An HTTP page calls the
 * node directly; an HTTPS page cannot (mixed content) and goes through the
 * same-origin `/api/lan-pair/plugin` proxy instead. Inline GCS modules load
 * and talk to their agent half through this, in signed-in mode too.
 *
 * @license GPL-3.0-only
 */

import { useNodeRegistryStore } from "@/stores/node-registry";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { resolvePairedAgentUrl, resolvePairedApiKey } from "@/lib/agent/resolve-agent";
import { timedFetch } from "@/lib/agent/agent-client/timeout";
import { PluginAgentClient, type AgentFetch } from "@/lib/agent/plugin-client";
import { relayProxyBaseUrl, resolveRelayReach } from "@/lib/nodes/relay-reach";

/** One node's agent reach. */
export interface NodeAgentReach {
  /** The node's own agent URL, or its ground station's on the relay lane. */
  hostUrl: string;
  /** The pairing key for `hostUrl`. */
  apiKey: string;
  /** On the relay lane, the drone's device id behind the ground station. */
  peerDeviceId: string | null;
}

/** True when the page is served over HTTPS, where a plain-HTTP node is
 * unreachable from the browser. */
export function isHttpsOrigin(): boolean {
  return typeof window !== "undefined" && window.location.protocol === "https:";
}

/**
 * The reach for `deviceId` (a bare agent device id): its own pairing record
 * first, else its ground station's relay. Null when this browser holds
 * neither.
 */
export function resolveNodeAgentReach(deviceId: string): NodeAgentReach | null {
  const hostUrl = resolvePairedAgentUrl(deviceId);
  const apiKey = resolvePairedApiKey(deviceId);
  if (hostUrl && apiKey) return { hostUrl, apiKey, peerDeviceId: null };
  const entry = useNodeRegistryStore.getState().getEntry(nodeIdForDevice(deviceId));
  const relay = resolveRelayReach({
    agentDeviceId: null,
    reachedVia: entry?.presence.reachedVia,
    droneDeviceId: deviceId,
  });
  return relay
    ? { hostUrl: relay.baseUrl, apiKey: relay.apiKey, peerDeviceId: relay.peerDeviceId }
    : null;
}

/**
 * A plugin client for `reach`. On an HTTPS page every call is rewritten onto
 * the same-origin plugin proxy; the pairing key still rides `X-ADOS-Key`.
 */
export function pluginClientForReach(reach: NodeAgentReach): PluginAgentClient {
  const base = (
    reach.peerDeviceId
      ? relayProxyBaseUrl({
          baseUrl: reach.hostUrl,
          apiKey: reach.apiKey,
          peerDeviceId: reach.peerDeviceId,
        })
      : reach.hostUrl
  ).replace(/\/$/, "");
  if (!isHttpsOrigin()) return new PluginAgentClient(base, reach.apiKey);
  const proxied: AgentFetch = (url, init, timeoutMs) => {
    // The client composed `<base>/api/plugins/...`; forward that path.
    const target = new URL(url.slice(base.length), "http://agent.invalid");
    const params = new URLSearchParams({ host: reach.hostUrl, path: target.pathname });
    if (target.search) params.set("query", target.search.slice(1));
    if (reach.peerDeviceId) params.set("peer", reach.peerDeviceId);
    return timedFetch(`/api/lan-pair/plugin?${params.toString()}`, init, timeoutMs);
  };
  return new PluginAgentClient(base, reach.apiKey, proxied);
}
