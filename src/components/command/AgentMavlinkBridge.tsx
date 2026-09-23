"use client";

/**
 * @module AgentMavlinkBridge
 * @description The single owner of the agent FC session. While the agent is
 * connected and reports an FC, it keeps a MAVLink (or MSP) session to that FC
 * open: it dials through `dialAgentFc` (ticketed WebSocket, bare WebSocket,
 * then the cloud relay), hands the session to DroneManager.addDrone() — which
 * activates telemetry, config panels, mission planning and flight commands —
 * and, whenever the session is missing, re-dials every 3 s with no cap.
 *
 * It stops only for a reason a retry cannot fix: the agent reports it needs
 * pairing, or the operator disconnected the FC on purpose. Either lasts until
 * the node, its FC or its link changes.
 *
 * Renders nothing — pure bridge component.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { onUnexpectedDisconnect, useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { resolveNodeId } from "@/lib/agent/node-id";
import { isMspVariant } from "@/lib/protocol/select-fc-adapter";
import { isFcReachable } from "@/lib/agent/mavlink-link";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";
import { dialAgentFc, planDialPaths } from "./agent-mavlink-dial";

/** Gap between session checks, and so between re-dials of a missing session. */
export const AGENT_FC_REDIAL_MS = 3_000;

export function AgentMavlinkBridge() {
  const mavlinkUrl = useAgentConnectionStore((s) => s.mavlinkUrl);
  const connected = useAgentConnectionStore((s) => s.connected);
  const nodeDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  const status = useAgentSystemStore((s) => s.status);
  const mavlinkWsUrlPrev = useAgentCapabilitiesStore(
    (s) => s.mavlinkWsUrlPrev,
  );
  // An MSP FC (Betaflight/iNav) never reports fc_connected — it sends no MAVLink
  // heartbeat — but it is reachable once the agent has identified the variant
  // and the serial transport is open, over the same byte-transparent proxy.
  const fcActive = isFcReachable({
    fcConnected: status?.fc_connected,
    fcVariant: status?.fc_variant,
    transportOpen: status?.transport_open,
  });
  const connectedDroneIdRef = useRef<string | null>(null);
  // Ids whose session dropped without anyone asking. Only those are re-dialled
  // after they vanish; a session removed on purpose stays down.
  const droppedRef = useRef(new Set<string>());
  const prevFcActiveRef = useRef(fcActive);
  const grantEpoch = useMqttControlGrantStore((s) => s.credentialEpoch);
  const prevGrantEpochRef = useRef(grantEpoch);
  const reselectAfterGrantRef = useRef<string | null>(null);

  useEffect(
    () =>
      onUnexpectedDisconnect((droneId) => {
        droppedRef.current.add(droneId);
      }),
    [],
  );

  // Tear down the session the moment the agent reports the FC gone, rather
  // than waiting for a transport close that can lag or never fire on a relayed
  // link. An intentional disconnect, so nothing tries to re-dial it.
  useEffect(() => {
    const prev = prevFcActiveRef.current;
    prevFcActiveRef.current = fcActive;
    if (prev && !fcActive && connectedDroneIdRef.current) {
      const droneId = connectedDroneIdRef.current;
      connectedDroneIdRef.current = null;
      useDroneManager.getState().disconnectDrone(droneId);
    }
  }, [fcActive]);

  // A minted write grant changes the broker principal, and an MQTT client cannot
  // swap credentials on a live socket. So when the credential changes under a
  // relay session, drop it: the supervisor below re-dials in the same breath,
  // this time as a command link. A WebSocket or serial FC carries its own
  // authority and is left alone.
  useEffect(() => {
    const prev = prevGrantEpochRef.current;
    prevGrantEpochRef.current = grantEpoch;
    if (prev === grantEpoch) return;
    const droneId = connectedDroneIdRef.current;
    if (!droneId) return;
    const manager = useDroneManager.getState();
    const drone = manager.drones.get(droneId);
    if (drone?.transport.type !== "mqtt-mavlink") return;
    // Read the selection BEFORE removing: removal clears it when the drone is
    // the selected one, and a renewal must not move the operator off it.
    if (manager.selectedDroneId === droneId) {
      reselectAfterGrantRef.current = droneId;
    }
    connectedDroneIdRef.current = null;
    manager.disconnectDrone(droneId);
  }, [grantEpoch]);

  // The session supervisor. Every AGENT_FC_REDIAL_MS it checks the session and
  // dials when there is none, for as long as the agent is connected with an FC.
  useEffect(() => {
    if (!connected || !fcActive) return;
    const readPlan = () => {
      const conn = useAgentConnectionStore.getState();
      return {
        mavlinkUrl,
        mavlinkWsUrlPrev,
        agentUrl: conn.agentUrl,
        apiKey: conn.apiKey,
        cloudDeviceId: conn.cloudDeviceId,
        mspLane: isMspVariant(useAgentSystemStore.getState().status?.fc_variant),
      };
    };
    const paths = planDialPaths(readPlan());
    if (!paths.auth && !paths.legacy && !paths.relay) return;

    // The canonical node id: `node:<deviceId>` for an agent-attached FC, stable
    // across local and cloud transports and matching the registry row.
    const droneId = resolveNodeId(nodeDeviceId ?? undefined);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (!cancelled) timer = setTimeout(() => void supervise(), AGENT_FC_REDIAL_MS);
    };

    const supervise = async () => {
      if (cancelled) return;
      const manager = useDroneManager.getState();
      const held = connectedDroneIdRef.current;
      if (held !== null) {
        if (held === droneId && manager.drones.has(held)) {
          schedule();
          return;
        }
        if (manager.drones.has(held)) {
          // A session for a different node than the one now selected.
          manager.disconnectDrone(held);
        } else if (!droppedRef.current.has(held)) {
          // Removed on purpose (the operator disconnected it): stay down.
          connectedDroneIdRef.current = null;
          return;
        }
        droppedRef.current.delete(held);
        connectedDroneIdRef.current = null;
      }
      if (await connectOnce()) schedule();
    };

    /** One dial. Returns false when a retry cannot help (pairing required). */
    const connectOnce = async (): Promise<boolean> => {
      const plan = readPlan();
      const outcome = await dialAgentFc(plan, () => cancelled);
      if (!outcome.transport) {
        if (!cancelled) console.warn("[AgentMavlinkBridge] All MAVLink connection methods failed");
        return !outcome.pairRequired;
      }
      const transport = outcome.transport;
      let handedOff = false;
      try {
        if (cancelled) return false;
        // Betaflight/iNav → MSP over the byte-transparent transport;
        // ArduPilot / PX4 / unidentified → MAVLink.
        const { createFcAdapter } = await import("@/lib/protocol/select-fc-adapter");
        const adapter = await createFcAdapter(
          useAgentSystemStore.getState().status?.fc_variant,
        );
        const vehicleInfo = await adapter.connect(transport);
        if (cancelled) {
          adapter.disconnect().catch(() => {});
          return false;
        }

        const presenceName = nodeDeviceId
          ? useNodeRegistryStore.getState().getEntry(droneId)?.presence.name
          : undefined;
        const droneName =
          presenceName || useAgentSystemStore.getState().status?.board?.name || "Drone";
        // The presence bridge owns the row whenever there is a node device id
        // to reconcile against; only own a standalone row when there is none.
        useDroneManager.getState().addDrone(
          droneId,
          droneName,
          adapter,
          transport,
          vehicleInfo,
          { type: outcome.connType, url: plan.mavlinkUrl || undefined },
          { ownsFleetRow: !nodeDeviceId },
        );
        handedOff = true;
        droppedRef.current.delete(droneId);
        connectedDroneIdRef.current = droneId;

        // Restore a selection a credential-driven teardown cleared: addDrone
        // auto-selects only the first managed drone.
        if (reselectAfterGrantRef.current === droneId) {
          reselectAfterGrantRef.current = null;
          useDroneManager.getState().selectDrone(droneId);
        }
      } catch (err) {
        console.warn("[AgentMavlinkBridge] MAVLink connection failed:", err);
      } finally {
        // A transport that connected but was never handed to the drone manager
        // (the handshake threw, or the run was cancelled) would leak a socket.
        if (!handedOff) {
          try {
            transport.disconnect();
          } catch {
            // best-effort teardown
          }
        }
      }
      return !cancelled;
    };

    void supervise();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      // The session itself persists across re-renders and route changes; the
      // teardown effects above and the operator own ending it.
    };
  }, [
    mavlinkUrl,
    mavlinkWsUrlPrev,
    connected,
    fcActive,
    nodeDeviceId,
    // Re-dial when the broker credential changes: the effect above has already
    // dropped the relay session holding the old one.
    grantEpoch,
  ]);

  return null;
}
