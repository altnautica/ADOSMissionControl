"use client";

/**
 * @module AgentMavlinkBridge
 * @description Automatically establishes a MAVLink connection to the ADOS Drone
 * Agent when the agent reports an FC connected. Tries three paths in order:
 *
 *   1. Authenticated WebSocket — the agent's raw MAVLink proxy URL dialed with
 *      a freshly-minted one-shot ticket carried as a WebSocket subprotocol.
 *      Authentication is orthogonal to the URL: the same proxy validates the
 *      ticket subprotocol for any profile. Used when a pairing key is held.
 *   2. Legacy raw WebSocket — the same proxy URL dialed bare (no subprotocol),
 *      for an unpaired agent in an open posture.
 *   3. MQTT relay (via the cloud relay) — works from anywhere.
 *
 * Once connected via any path, calls DroneManager.addDrone() which activates
 * all GCS features (telemetry, config panels, mission planning, flight commands).
 *
 * Renders nothing — pure bridge component.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { resolveNodeId } from "@/lib/agent/node-id";
import type { Transport } from "@/lib/protocol/types/transport";
import {
  mintWsTicket,
  WS_TICKET_PROTOCOL,
} from "@/lib/api/ground-station/ws-ticket";
import { isMspVariant } from "@/lib/protocol/select-fc-adapter";
import { isFcReachable } from "@/lib/agent/mavlink-link";
import {
  relayWriteAuthFor,
  useMqttControlGrantStore,
} from "@/stores/mqtt-control-grant-store";

const WS_TIMEOUT_MS = 3000;

// Ports the MAVLink bridge will refuse to dial on a derived ws://
// URL even if the agent advertises one. 5760 is the ArduPilot SITL TCP
// listener; an `ws://localhost:5760/` attempt at boot has been observed
// in console logs with no user gesture, suggesting a stale advertised
// URL slipped past the agent-URL hostname check below. Block defensively
// so the symptom can never re-appear regardless of root cause. Triage
// this list further when the source is pinned (DevTools Network tab,
// "Initiator" column on the failed WS row, plus an IndexedDB scan of
// idb-keyval-store for any stored ws:// URL).
const FORBIDDEN_DERIVED_WS_PORTS = new Set(["5760"]);

/**
 * Force a ws:// URL to wss:// when the GCS page is served over https, so
 * the authenticated dial isn't blocked as mixed content. A URL already on
 * wss:// (or any non-ws scheme) is returned untouched. Returns null on a
 * malformed URL so the caller can skip the dial.
 */
function secureWsUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const pageSecure =
      typeof window !== "undefined" &&
      window.location.protocol === "https:";
    if (pageSecure && u.protocol === "ws:") {
      u.protocol = "wss:";
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function AgentMavlinkBridge() {
  const mavlinkUrl = useAgentConnectionStore((s) => s.mavlinkUrl);
  const connected = useAgentConnectionStore((s) => s.connected);
  const nodeDeviceId = useAgentConnectionStore((s) => s.nodeDeviceId);
  const status = useAgentSystemStore((s) => s.status);
  const mavlinkWsUrlPrev = useAgentCapabilitiesStore(
    (s) => s.mavlinkWsUrlPrev,
  );
  // An MSP FC (Betaflight/iNav) never reports fc_connected — it sends no MAVLink
  // heartbeat, so the agent keeps fc_connected false by design. But it IS
  // reachable once the agent has identified the variant off the USB descriptor
  // and the serial transport is open, and the GCS drives it over the same
  // byte-transparent :8765 proxy with the MSP adapter. isFcReachable folds that
  // in so a Betaflight/iNav board auto-connects like a MAVLink FC does.
  const fcActive = isFcReachable({
    fcConnected: status?.fc_connected,
    fcVariant: status?.fc_variant,
    transportOpen: status?.transport_open,
  });
  const connectingRef = useRef(false);
  const connectedDroneIdRef = useRef<string | null>(null);
  const prevFcActiveRef = useRef(fcActive);
  const grantEpoch = useMqttControlGrantStore((s) => s.credentialEpoch);
  const prevGrantEpochRef = useRef(grantEpoch);
  const reselectAfterGrantRef = useRef<string | null>(null);

  // Tear down the MAVLink session the moment the agent reports the FC
  // disconnected, rather than waiting for the transport "close" event (which
  // can lag or never fire on a relayed link). On a true->false transition
  // while this bridge owns a connected drone, remove it so the FC panels stop
  // rendering stale telemetry and queued writes stop going to a dead link.
  // removeDrone keeps a presence-bridge-owned fleet row in place, so the node
  // card reverts to "flight controller not connected" instead of vanishing.
  useEffect(() => {
    const prev = prevFcActiveRef.current;
    prevFcActiveRef.current = fcActive;
    if (prev && !fcActive && connectedDroneIdRef.current) {
      const droneId = connectedDroneIdRef.current;
      connectedDroneIdRef.current = null;
      useDroneManager.getState().removeDrone(droneId);
      // Detach the FC from the registry row: the node reverts to "no FC
      // attached" (projection hides arm/mode/battery) but the presence row
      // survives. Clear the connection's fcConnected flag too.
      const registry = useNodeRegistryStore.getState();
      registry.updateConnection(droneId, { fcConnected: false });
      registry.detachFc(droneId);
    }
  }, [fcActive]);

  // A minted write grant changes the broker principal, and an MQTT client cannot
  // swap credentials on a live socket. So when the credential changes under a
  // relay session, drop it: the dial below re-establishes it in the same breath,
  // this time as a command link rather than a receive-only one. Only the relay
  // lane cares — a direct WebSocket or serial FC carries its own authority and
  // must not be disturbed by a broker credential it never used.
  useEffect(() => {
    const prev = prevGrantEpochRef.current;
    prevGrantEpochRef.current = grantEpoch;
    if (prev === grantEpoch) return;
    const droneId = connectedDroneIdRef.current;
    if (!droneId) return;
    const manager = useDroneManager.getState();
    const drone = manager.drones.get(droneId);
    if (drone?.transport.type !== "mqtt-mavlink") return;
    // Read the selection BEFORE removing: removeDrone clears it when the drone
    // going away is the selected one, and a credential renewal must not move the
    // operator off the vehicle they are flying.
    if (manager.selectedDroneId === droneId) {
      reselectAfterGrantRef.current = droneId;
    }
    connectedDroneIdRef.current = null;
    manager.removeDrone(droneId);
  }, [grantEpoch]);

  useEffect(() => {
    // Latest-value reads that must NOT re-trigger this effect: the agent URL
    // and the cloud-relay device id change atomically with the connection
    // inputs that ARE dependencies, so read them at execution time rather than
    // as closure deps (which would re-fire the dial on every change).
    const agentUrl = useAgentConnectionStore.getState().agentUrl;
    const cloudDeviceId = useAgentConnectionStore.getState().cloudDeviceId;
    const apiKey = useAgentConnectionStore.getState().apiKey;

    // Authentication is orthogonal to the URL: the raw MAVLink proxy
    // validates a ticket subprotocol for any profile, so the cascade always
    // dials `mavlinkUrl` and attaches a ticket when a pairing key is held.
    // Two booleans derived from `mavlinkUrl` gate the dial:
    //   - `urlUsable`   — the URL is present, parseable, not a forbidden
    //                     port, and (when an agent URL is set) shares the
    //                     agent host. Mixed content does NOT disqualify it:
    //                     Try 1 upgrades ws→wss via secureWsUrl().
    //   - `legacyUsable` — `urlUsable` AND not blocked as mixed content
    //                     (i.e. not an https page dialing a bare ws:// URL).
    let urlUsable = !!mavlinkUrl;
    let legacyUsable = !!mavlinkUrl;
    if (mavlinkUrl) {
      try {
        const wsUrl = new URL(mavlinkUrl);
        if (FORBIDDEN_DERIVED_WS_PORTS.has(wsUrl.port)) {
          console.debug(
            "[AgentMavlinkBridge] dropping mavlinkUrl: forbidden port",
            wsUrl.port,
          );
          urlUsable = false;
          legacyUsable = false;
        } else if (agentUrl) {
          const agentHost = new URL(agentUrl).hostname;
          if (wsUrl.hostname !== agentHost) {
            console.debug(
              "[AgentMavlinkBridge] dropping mavlinkUrl: hostname mismatch",
              { mavlinkUrl, agentUrl },
            );
            urlUsable = false;
            legacyUsable = false;
          }
        }
        // On an HTTPS-origin GCS the browser blocks an insecure ws:// dial
        // as mixed content. That only disqualifies the bare legacy dial:
        // Try 1 upgrades the URL to wss:// before dialing, so `urlUsable`
        // stays true for the authenticated path.
        if (
          urlUsable &&
          typeof window !== "undefined" &&
          window.location.protocol === "https:" &&
          wsUrl.protocol === "ws:"
        ) {
          console.debug(
            "[AgentMavlinkBridge] legacy ws:// blocked as mixed content on an https origin; using the wss:// authenticated dial instead",
            { mavlinkUrl },
          );
          legacyUsable = false;
        }
      } catch {
        // Malformed URL — neither dial can use it.
        urlUsable = false;
        legacyUsable = false;
      }
    }

    // Need at least: agent connected + FC connected + at least one dialable
    // path (a ticketed authenticated dial, the bare legacy dial, or the
    // cloud MQTT relay).
    if (!connected || !fcActive || connectingRef.current) return;
    const authUsable = urlUsable && !!apiKey && !!agentUrl;
    if (!authUsable && !legacyUsable && !cloudDeviceId) return;

    // Skip the MQTT MAVLink relay path on localhost dev mode
    // when no direct LAN WebSocket is available. The cloud MQTT MAVLink relay
    // requires production cloud infrastructure that doesn't exist for the
    // bench user, and the attempt always fails after 10s with the
    // "No heartbeat received within 10 seconds" error spamming the console.
    // Telemetry is already covered by MqttBridge.tsx in this mode, so the
    // missing MAVLinkAdapter just disables binary command/control (which is
    // fine for monitoring-only sessions).
    const isLocalDev =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");
    if (isLocalDev && !authUsable && !legacyUsable) {
      return;
    }

    // Don't reconnect if already connected to a drone from this bridge
    if (connectedDroneIdRef.current) {
      const existing = useDroneManager.getState().drones.get(connectedDroneIdRef.current);
      if (existing) return;
      connectedDroneIdRef.current = null;
    }

    connectingRef.current = true;
    let cancelled = false;

    async function connectMavlink() {
      // Track the live transport and whether it was handed to the drone
      // manager. If adapter.connect() (or any later step) throws after a
      // transport has connected, the outer catch disconnects it so the open
      // socket isn't leaked.
      let connectedTransport: Transport | undefined;
      let handedOff = false;
      try {
        if (cancelled) return;

        let transport: Transport | undefined;
        let connType: "websocket" | "mqtt-mavlink" = "websocket";

        // The FC family the agent identified on the serial link, read at
        // execution time (like agentUrl/apiKey above) so it does not re-fire
        // the dial; the variant is known once the FC is active. It picks
        // both the MQTT relay lane (below) and the adapter (further down):
        // Betaflight/iNav → MSP over the msp lane; ArduPilot/PX4/unknown →
        // MAVLink over the mavlink lane.
        const fcVariant = useAgentSystemStore.getState().status?.fc_variant;
        const mspLane = isMspVariant(fcVariant);

        const { WebSocketTransport } = await import(
          "@/lib/protocol/transport/websocket"
        );
        const tryWs = async (
          url: string,
          protocols?: string | string[],
        ): Promise<InstanceType<typeof WebSocketTransport>> => {
          const wsTransport = new WebSocketTransport();
          await Promise.race([
            wsTransport.connect(url, protocols),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("timeout")), WS_TIMEOUT_MS),
            ),
          ]);
          return wsTransport;
        };

        // Try 1: the raw MAVLink proxy dialed with a one-shot ticket. When a
        // pairing key is held, mint a `gs.mavlink_ws` ticket and carry it as a
        // WebSocket subprotocol so it never reaches the URL; the same proxy
        // validates the ticket for any profile. On a secure GCS origin the
        // ws:// URL is upgraded to wss:// (the only dial that survives
        // mixed-content blocking). With no pairing key (unpaired) this path is
        // skipped and the cascade keeps the open-posture legacy behavior.
        if (!transport && authUsable && mavlinkUrl) {
          const secured = secureWsUrl(mavlinkUrl);
          if (secured) {
            try {
              const ticket = await mintWsTicket(
                { baseUrl: agentUrl, apiKey },
                "gs.mavlink_ws",
              );
              if (cancelled) return;
              transport = ticket
                ? await tryWs(secured, [WS_TICKET_PROTOCOL, ticket])
                : undefined;
              connType = "websocket";
            } catch {
              transport = undefined;
            }
          }
        }

        // Try 2: legacy raw direct WebSocket dialed bare (LAN, lowest
        // latency, open posture). When the agent has rotated its WebSocket
        // binding (port change, network move) the heartbeat carries the
        // prior URL; if the current URL fails we retry the prior URL once
        // before falling through to the MQTT relay path so a brief rotation
        // doesn't drop an in-flight session.
        if (!transport && legacyUsable && mavlinkUrl) {
          try {
            transport = await tryWs(mavlinkUrl);
          } catch {
            // Retry the prior WS URL once (handles an agent WS-binding
            // rotation); if that also fails, fall through to the MQTT relay.
            if (mavlinkWsUrlPrev && mavlinkWsUrlPrev !== mavlinkUrl) {
              try {
                transport = await tryWs(mavlinkWsUrlPrev);
              } catch {
                // previous URL also failed; MQTT relay is the next fallback
              }
            }
          }
        }

        // Try 3: MQTT relay (cloud, works from anywhere). An MSP FC rides the
        // agent's parallel MSP topic lane; a MAVLink FC the mavlink lane.
        if (!transport && cloudDeviceId) {
          try {
            const { MqttMavlinkTransport } = await import(
              "@/lib/protocol/transport/mqtt-mavlink"
            );
            const mqttTransport = new MqttMavlinkTransport(
              mspLane ? "msp" : "mavlink",
            );
            // The operator's minted write grant, when one covers this drone.
            // Read at execution time from the grant store rather than closed
            // over, so a dial that races a renewal uses the credential that is
            // live now. Absent (signed out, no grant yet, or a drone this
            // operator does not own) the session still connects receive-only —
            // telemetry, state and vehicle identity all arrive over it — and the
            // transport says so rather than implying a command link.
            await mqttTransport.connect(
              cloudDeviceId,
              undefined,
              relayWriteAuthFor(cloudDeviceId),
            );
            transport = mqttTransport;
            connType = "mqtt-mavlink";
            if (!mqttTransport.canCommand) {
              console.warn(
                "[AgentMavlinkBridge] Relay session is receive-only: telemetry will " +
                  "flow but commands cannot be sent to this vehicle",
              );
            }
          } catch (mqttErr) {
            console.warn("[AgentMavlinkBridge] MQTT relay failed:", mqttErr);
          }
        }

        if (!transport) {
          console.warn("[AgentMavlinkBridge] All MAVLink connection methods failed");
          return;
        }
        connectedTransport = transport;

        if (cancelled) {
          transport.disconnect();
          return;
        }

        // Select the adapter from the same FC family read above (mspLane).
        // Betaflight/iNav → MSP over the byte-transparent transport;
        // ArduPilot / PX4 / unidentified / older agents → MAVLink.
        const { createFcAdapter } = await import(
          "@/lib/protocol/select-fc-adapter"
        );
        const adapter = await createFcAdapter(fcVariant);
        const vehicleInfo = await adapter.connect(transport);

        if (cancelled) {
          adapter.disconnect();
          transport.disconnect();
          return;
        }

        // The canonical node id: `node:<deviceId>` for a paired agent (stable
        // across local + cloud transports, matching the registry / fleet row),
        // or a fresh `fc:<random>` for a direct USB/serial FC with no agent
        // identity. There is no `agent-<timestamp>` escape hatch any more — the
        // registry GC keys off this id, and a timestamped id would orphan the
        // row on every reconnect.
        const droneId = resolveNodeId(nodeDeviceId ?? undefined);
        const registry = useNodeRegistryStore.getState();
        const presenceName = nodeDeviceId
          ? registry.getEntry(droneId)?.presence.name
          : undefined;
        const droneName =
          presenceName ||
          useAgentSystemStore.getState().status?.board?.name ||
          "Drone";
        // The presence bridge owns the row whenever there is a node device id to
        // reconcile against; only own a standalone row when there is none.
        const ownsFleetRow = !nodeDeviceId;

        // Attach the FC to the registry FIRST so a late presence patch merges
        // onto the row instead of being dropped (fixes the bare-row race), and
        // bind the connection transport. attachFc creates the row when this is
        // a direct-USB FC with no prior presence.
        registry.attachFc(droneId, droneId);
        registry.updateConnection(droneId, {
          transport: connType,
          mavlinkUrl: mavlinkUrl || undefined,
          fcConnected: true,
          // Recorded from the transport rather than assumed from the fact that
          // a connection was established. These differ on the relay: the FC is
          // attached and talking while the send lane is refused, and reporting
          // only `fcConnected` is what let that read as a live command link.
          canCommand: transport.canCommand,
        });

        useDroneManager.getState().addDrone(
          droneId,
          droneName,
          adapter,
          transport,
          vehicleInfo,
          { type: connType, url: mavlinkUrl || undefined },
          { ownsFleetRow },
        );

        // Restore the selection a credential-driven teardown cleared. addDrone
        // auto-selects only the FIRST managed drone, so an operator flying one of
        // several would otherwise be moved off it every time a grant renewed.
        if (reselectAfterGrantRef.current === droneId) {
          reselectAfterGrantRef.current = null;
          useDroneManager.getState().selectDrone(droneId);
        }

        handedOff = true;
        connectedDroneIdRef.current = droneId;
      } catch (err) {
        console.warn("[AgentMavlinkBridge] MAVLink connection failed:", err);
      } finally {
        // A transport that connected but was never handed to the drone manager
        // (e.g. adapter handshake threw) would otherwise leak an open socket.
        if (connectedTransport && !handedOff) {
          try {
            connectedTransport.disconnect();
          } catch {
            // best-effort teardown
          }
        }
        connectingRef.current = false;
      }
    }

    connectMavlink();

    return () => {
      cancelled = true;
      connectingRef.current = false;
      // Don't disconnect the drone on unmount — the MAVLink connection should
      // persist across tab navigations. DroneManager handles its own lifecycle.
      // Only disconnect if the agent connection itself is dropped (handled by
      // transport "close" event → DroneManager.removeDrone automatically).
    };
  }, [
    mavlinkUrl,
    mavlinkWsUrlPrev,
    connected,
    fcActive,
    nodeDeviceId,
    // Re-dial when the broker credential changes: the effect above has already
    // dropped the relay session that was holding the old one, so this is what
    // rebuilds it with the new grant.
    grantEpoch,
  ]);

  return null;
}
