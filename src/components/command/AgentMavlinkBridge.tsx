"use client";

/**
 * @module AgentMavlinkBridge
 * @description The single owner of agent FC sessions. It keeps a MAVLink (or
 * MSP) session open to every agent FC the GCS should hold: the focused
 * agent's, and every LAN-paired node's whose agent reports an FC, focused or
 * not (`agent-fc-targets`). A page loaded fresh has no focused agent, and
 * leaving a node's page releases the focus, yet the planner, the fleet and
 * every route still need the vehicle.
 *
 * Each session is dialled through `dialAgentFc` (ticketed WebSocket, bare
 * WebSocket, then the cloud relay), handed to DroneManager.addDrone() — which
 * activates telemetry, config panels, mission planning and flight commands —
 * and, whenever it is missing, re-dialled every 3 s with no cap
 * (`agent-fc-supervisor`).
 *
 * Renders nothing — pure bridge component.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { onUnexpectedDisconnect } from "@/stores/drone-manager";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";
import { isDemoMode } from "@/lib/utils";
import { AgentFcSupervisor } from "./agent-fc-supervisor";

export function AgentMavlinkBridge() {
  // Subscriptions only: the supervisor re-reads every input from the stores.
  const connected = useAgentConnectionStore((s) => s.connected);
  const nodeDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  const mavlinkUrl = useAgentConnectionStore((s) => s.mavlinkUrl);
  const agentUrl = useAgentConnectionStore((s) => s.agentUrl);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const status = useAgentSystemStore((s) => s.status);
  const lanNodes = useLocalNodesStore((s) => s.nodes);
  const lanStatuses = useCommandFleetStore((s) => s.cloudStatuses);
  const grantEpoch = useMqttControlGrantStore((s) => s.credentialEpoch);

  const supervisorRef = useRef<AgentFcSupervisor | null>(null);
  supervisorRef.current ??= new AgentFcSupervisor();

  useEffect(() => {
    const supervisor = supervisorRef.current!;
    const unsubscribe = onUnexpectedDisconnect((droneId) => supervisor.markDropped(droneId));
    return () => {
      unsubscribe();
      supervisor.dispose();
    };
  }, []);

  useEffect(() => {
    // The demo flies its own simulated aircraft; nothing real to dial.
    if (isDemoMode()) return;
    supervisorRef.current!.reconcile(grantEpoch);
  }, [
    connected,
    nodeDeviceId,
    mavlinkUrl,
    agentUrl,
    cloudDeviceId,
    status,
    lanNodes,
    lanStatuses,
    grantEpoch,
  ]);

  return null;
}
