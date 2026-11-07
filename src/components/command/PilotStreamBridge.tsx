"use client";

/**
 * @module PilotStreamBridge
 * @description Always-mounted opener of the selected drone's pilot stream
 * (`WS /api/v1/pilot/stream`, ticket scope `pilot.control`). It resolves the
 * drone's LAN host and pairing key local-first, like the nav stream. The
 * stream carries this surface's sticks and flight actions to the drone's
 * pilot and brings back the pilot state. Renders null; inert in demo (the
 * demo pilot answers in its place).
 * @license GPL-3.0-only
 */

import { useEffect, useMemo } from "react";

import { connectPilotStream } from "@/lib/input/pilot-stream";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { resolveLanAgentUrl, resolvePairedApiKey } from "@/lib/agent/resolve-agent";
import { useDroneManager } from "@/stores/drone-manager";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

export function PilotStreamBridge() {
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
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
    const conn = connectPilotStream({ droneId, agentUrl, apiKey });
    return () => conn.close();
  }, [droneId, agentUrl, apiKey]);

  return null;
}
