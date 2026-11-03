"use client";

/**
 * @module NavStreamBridge
 * @description Always-mounted opener for the selected drone's navigation feed
 * (`WS /api/v1/nav/stream` plus the 1 Hz `map/live` occupancy poll). Resolves
 * the drone's LAN host and pairing key local-first, like the detection bridge,
 * so the HUD, minimap, radar and Map tab read live follow / nav / pose / scan /
 * map state on any tab. Renders null; inert in demo (the demo generator feeds
 * the store) and when no LAN path exists.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";

import { connectNavStream } from "@/lib/agent/nav-stream";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { resolveLanAgentUrl, resolvePairedApiKey } from "@/lib/agent/resolve-agent";
import { useDroneManager } from "@/stores/drone-manager";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

export function NavStreamBridge() {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  // Reconnect when a node's host/key appears or changes.
  const nodes = useLocalNodesStore((s) => s.nodes);

  const target = useMemo(() => {
    const deviceId = selectedDroneId ? deviceIdFromNodeId(selectedDroneId) : null;
    if (!selectedDroneId || !deviceId) return null;
    const agentUrl = resolveLanAgentUrl(deviceId);
    if (!agentUrl) return null;
    return { droneId: selectedDroneId, agentUrl, apiKey: resolvePairedApiKey(deviceId) };
    // `nodes` is the reactive trigger for the resolvers, which read the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDroneId, nodes]);

  const droneId = target?.droneId ?? null;
  const agentUrl = target?.agentUrl ?? null;
  const apiKey = target?.apiKey ?? null;

  useEffect(() => {
    if (!droneId || !agentUrl) return;
    const conn = connectNavStream({ droneId, agentUrl, apiKey });
    return () => conn.close();
  }, [droneId, agentUrl, apiKey]);

  return null;
}
