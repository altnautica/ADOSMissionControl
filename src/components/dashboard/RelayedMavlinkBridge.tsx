"use client";

/**
 * @module RelayedMavlinkBridge
 * @description Opens a live MAVLink session for each drone reached ONLY
 * through a directly-paired ground station's WFB relay, dialed against the
 * ground station's own MAVLink-WS republish endpoint (`ados-mavlink-router`'s
 * `:8765`) rather than against the drone directly — the GCS holds no LAN/cloud
 * credential for the drone itself, only for the ground station relaying it.
 *
 * Root cause this closes: a relayed drone's header badge (fed by registry
 * presence, genuinely fresh off the ground station's WFB peer telemetry) could
 * read ONLINE while its Setup/Parameters tabs rendered "Agent offline, no
 * heartbeat" — because nothing ever opened a live `DroneProtocol` session for
 * it, so `drone-manager.drones.has(droneId)` (what those tabs gate on) stayed
 * permanently false. The ground station's republish endpoint was already
 * serving the drone's real MAVLink stream the whole time; this bridge is the
 * missing wire, not new capability.
 *
 * Deliberately independent of `AgentMavlinkBridge` / `useAgentConnectionStore`:
 * that pipeline models ONE focused node's own LAN/cloud agent session, guarded
 * by a hostname-mismatch check that exists specifically to stop a foreign host
 * riding it — the wrong tool for N background sessions dialed against OTHER
 * agents' relay endpoints. Instead this bridge:
 *
 *   1. reuses `planRelayedEnrollment` (the exact enrollment `RelayedDroneBridge`
 *      computes) to find every relay-only drone and the ground node it is
 *      reached through;
 *   2. resolves that ground node's LAN credentials via
 *      `resolveLocalAgentForDrone` (the GCS already holds these — it IS paired
 *      to the ground station directly);
 *   3. mints a `gs.mavlink_ws` ticket against the ground station — its
 *      `ados-mavlink-router` validates the identical ticket issuer the
 *      agent's own `/api/_ws/ticket` uses, so no agent-side change is needed;
 *   4. dials the ground station's `:8765` and registers the resulting
 *      `DroneProtocol` into `drone-manager` KEYED BY THE DRONE's nodeId (not
 *      the ground station's), `ownsFleetRow: false` since `RelayedDroneBridge`
 *      already owns the drone's presence row.
 *
 * A drone that is ALSO paired directly is skipped entirely — its own
 * `AgentMavlinkBridge` session already owns that same node id, and re-adding
 * under it would tear that (better) direct session down.
 *
 * Known limitation (tracked, not solved here): `ados-mavlink-router` on the
 * ground station is single-source today, so two DIFFERENT drones relayed
 * through the SAME ground station would both attach to whichever sysid
 * heartbeats first on its one `:8765` socket. Safe for one relayed drone per
 * ground station; N>1 needs an agent-side per-peer port or sysid filter.
 *
 * Renders nothing — pure bridge component, mounted once beside
 * `RelayedDroneBridge`.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";

import { usePairingStore } from "@/stores/pairing-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import {
  useCommandFleetStore,
  type CommandCloudStatus,
} from "@/stores/command-fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import { normalizeRadio } from "@/stores/agent-capabilities/normalizer";
import { linkStateReach } from "@/components/hardware/radio/labels";
import { resolveLocalAgentForDrone } from "@/lib/agent/resolve-agent";
import {
  planRelayedEnrollment,
  type RelayGroundNode,
} from "@/lib/agent/relayed-peers";
import {
  mintWsTicket,
  WS_TICKET_PROTOCOL,
} from "@/lib/api/ground-station/ws-ticket";
import type { Transport } from "@/lib/protocol/types/transport";

/** Re-check for a relay-eligible drone whose session isn't up yet (never
 * dialed, or dropped and awaiting retry). Independent of the enrollment
 * effect below, which only re-runs on a genuine store change — a failed WS
 * dial must still retry on its own cadence rather than wait for one. */
const RETRY_INTERVAL_MS = 5000;

const WS_TIMEOUT_MS = 5000;

/** True only when the node's WFB link is verified up. A missing or unproven
 * radio block is NOT up (Rule 44) — mirrors `RelayedDroneBridge`'s gate so
 * both bridges agree on when a relay is real. */
function radioUpFor(status: CommandCloudStatus | undefined): boolean {
  const radio = status?.radio ? normalizeRadio(status.radio) : null;
  return radio != null && linkStateReach(radio.state) === "up";
}

/** Upgrade ws:// to wss:// when the GCS page is served over https, so the
 * dial isn't blocked as mixed content. Mirrors `AgentMavlinkBridge`'s helper. */
function secureWsUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const pageSecure =
      typeof window !== "undefined" && window.location.protocol === "https:";
    if (pageSecure && u.protocol === "ws:") u.protocol = "wss:";
    return u.toString();
  } catch {
    return null;
  }
}

export function RelayedMavlinkBridge() {
  const pairedDrones = usePairingStore((s) => s.pairedDrones);
  const localNodes = useLocalNodesStore((s) => s.nodes);
  const cloudStatuses = useCommandFleetStore((s) => s.cloudStatuses);

  // nodeIds this bridge currently holds a live session for, and ones mid-dial
  // (so a retry tick never opens a second concurrent dial for the same drone).
  const connectedIds = useRef<Set<string>>(new Set());
  const connectingIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    async function connectOne(
      nodeId: string,
      droneDeviceId: string,
      agent: { agentUrl: string; apiKey: string },
    ) {
      let transport: Transport | undefined;
      let handedOff = false;
      try {
        const wsUrl = secureWsUrl(
          `ws://${new URL(agent.agentUrl).hostname}:8765/`,
        );
        if (!wsUrl) return;

        const ticket = await mintWsTicket(
          { baseUrl: agent.agentUrl, apiKey: agent.apiKey },
          "gs.mavlink_ws",
        );
        if (!ticket) return; // ground station reports no pairing key — nothing to authenticate the dial with

        const { WebSocketTransport } = await import(
          "@/lib/protocol/transport/websocket"
        );
        const wsTransport = new WebSocketTransport();
        await Promise.race([
          wsTransport.connect(wsUrl, [WS_TICKET_PROTOCOL, ticket]),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timeout")), WS_TIMEOUT_MS),
          ),
        ]);
        transport = wsTransport;

        // The relayed drone's FC variant, once the aux-lane status funnel has
        // reported one (RelayedDroneBridge writes it onto this same row);
        // absent, `createFcAdapter` defaults to MAVLink — correct for an
        // unidentified or pre-fix agent.
        const fcVariant =
          useCommandFleetStore.getState().cloudStatuses[droneDeviceId]
            ?.fcVariant;
        const { createFcAdapter } = await import(
          "@/lib/protocol/select-fc-adapter"
        );
        const adapter = await createFcAdapter(fcVariant);
        const vehicleInfo = await adapter.connect(transport);
        handedOff = true;

        const name = `Agent ${droneDeviceId.slice(0, 8)}`;
        useDroneManager
          .getState()
          .addDrone(
            nodeId,
            name,
            adapter,
            transport,
            vehicleInfo,
            { type: "websocket", url: wsUrl },
            { ownsFleetRow: false },
          );
        connectedIds.current.add(nodeId);
      } catch (err) {
        console.warn(
          "[RelayedMavlinkBridge] MAVLink connection failed:",
          err,
        );
        if (transport && !handedOff) {
          try {
            transport.disconnect();
          } catch {
            // best-effort teardown
          }
        }
      }
    }

    function reconcile() {
      const directDeviceIds = new Set<string>();
      for (const d of pairedDrones) directDeviceIds.add(d.deviceId);
      for (const n of localNodes) directDeviceIds.add(n.deviceId);

      const groundNodes: RelayGroundNode[] = [];
      const seenGs = new Set<string>();
      const addGs = (deviceId: string, profile: string | undefined) => {
        if (profile !== "ground-station") return;
        if (seenGs.has(deviceId)) return;
        seenGs.add(deviceId);
        const status = cloudStatuses[deviceId];
        groundNodes.push({
          deviceId,
          nodeId: `node:${deviceId}`,
          status,
          radioUp: radioUpFor(status),
        });
      };
      for (const d of pairedDrones) addGs(d.deviceId, d.profile);
      for (const n of localNodes) addGs(n.deviceId, n.profile);

      const enrollments = planRelayedEnrollment({
        groundNodes,
        directlyPairedDeviceIds: directDeviceIds,
      });

      const wanted = new Set<string>();
      for (const e of enrollments) {
        // A drone that is ALSO directly paired owns its own AgentMavlinkBridge
        // session under this same node id — never compete with it.
        if (directDeviceIds.has(e.deviceId)) continue;
        const groundDeviceId = deviceIdFromNodeId(e.reachedVia);
        if (!groundDeviceId) continue;
        wanted.add(e.nodeId);

        if (connectedIds.current.has(e.nodeId)) {
          if (useDroneManager.getState().drones.has(e.nodeId)) continue;
          // Torn down from under us (e.g. transport closed) — clear so a
          // retry can re-dial.
          connectedIds.current.delete(e.nodeId);
        }
        if (connectingIds.current.has(e.nodeId)) continue;

        const agent = resolveLocalAgentForDrone(groundDeviceId);
        // The ground station is cloud-only in this browser (no LAN pairing) —
        // there is no browser-reachable host to dial yet.
        if (!agent) continue;

        connectingIds.current.add(e.nodeId);
        connectOne(e.nodeId, e.deviceId, agent).finally(() => {
          connectingIds.current.delete(e.nodeId);
        });
      }

      // Tear down sessions for drones no longer relay-eligible: the ground
      // link dropped, the peer is no longer reported, or the drone was just
      // paired directly (its new AgentMavlinkBridge session takes over the id).
      for (const nodeId of Array.from(connectedIds.current)) {
        if (!wanted.has(nodeId)) {
          connectedIds.current.delete(nodeId);
          useDroneManager.getState().removeDrone(nodeId);
        }
      }
    }

    reconcile();
    const timer = setInterval(reconcile, RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [pairedDrones, localNodes, cloudStatuses]);

  // On unmount, tear down every session this bridge opened. Captures the Set
  // object itself at effect-setup time (it is mutated in place by the
  // reconcile effect above, never reassigned, so this reference stays valid
  // for the component's whole lifetime and still reflects live membership).
  useEffect(() => {
    const owned = connectedIds.current;
    return () => {
      for (const nodeId of owned) {
        useDroneManager.getState().removeDrone(nodeId);
      }
      owned.clear();
    };
  }, []);

  return null;
}
