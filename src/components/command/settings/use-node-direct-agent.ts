"use client";

/**
 * @module command/settings/use-node-direct-agent
 * @description The focused agent connection, but only when it serves the node
 * a settings page is rendered for.
 *
 * `agent-connection-store` holds one connection (client, base URL, API key) for
 * the focused node, and focus lags the rendered page: it is applied after
 * render, a failed connect leaves the previous node attached, and a node with
 * no LAN credentials never replaces it. A page that reads or writes through the
 * ambient connection can therefore show node A's Wi-Fi, modem or signing state
 * under node B's name and send B's "Leave network" to A. Pages that call the
 * agent's own REST routes (not the config document) resolve their transport
 * here and render "needs a direct connection" when this returns null.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type { AgentClient } from "@/lib/agent/client";
import { isDemoMode } from "@/lib/utils";

export interface NodeDirectAgent {
  /** The node's agent base URL (its own origin, or a relay-proxy prefix). */
  agentUrl: string;
  apiKey: string | null;
  /** The typed agent client, when one is built for this connection. A cloud
   * session keeps the node's LAN URL and key but builds no client. */
  client: AgentClient | null;
}

/**
 * @param nodeDeviceId The device id of the node the page is rendered for.
 * @returns The attached connection when it belongs to `nodeDeviceId`, else
 *   null. Identity-stable while the attachment and node stay the same, so a
 *   page may key effects on it and drop in-flight results when it changes.
 */
export function useNodeDirectAgent(
  nodeDeviceId: string | null,
): NodeDirectAgent | null {
  const client = useAgentConnectionStore((s) => s.client);
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const apiKey = useAgentConnectionStore((s) => s.apiKey);
  const attachedDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);

  // DEMO-MODE BRANCH (gated on isDemoMode, real fleets unaffected): the demo
  // attaches one mock agent and never sets a focused device id, so the
  // identity gate would detach every simulated node. `useNodeConfig` takes the
  // same branch. An unknown node id never borrows the ambient connection.
  const belongs =
    isDemoMode() || (!!attachedDeviceId && attachedDeviceId === nodeDeviceId);

  return useMemo(
    () => (belongs && agentUrl ? { agentUrl, apiKey, client } : null),
    [belongs, agentUrl, apiKey, client],
  );
}
