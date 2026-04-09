"use client";

/**
 * @module AgentMavlinkBridge
 * @description Automatically establishes a MAVLink connection to the ADOS Drone
 * Agent when the agent reports an FC connected. Tries two paths in order:
 *
 *   1. Direct WebSocket (ws://agent:8765/) — lowest latency, works on LAN
 *   2. MQTT relay (via mqtt.altnautica.com) — works from anywhere
 *
 * Once connected via either path, calls DroneManager.addDrone() which activates
 * all GCS features (telemetry, config panels, mission planning, flight commands).
 *
 * Renders nothing — pure bridge component.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useDroneManager } from "@/stores/drone-manager";
import type { Transport } from "@/lib/protocol/types/transport";

const WS_TIMEOUT_MS = 3000;

export function AgentMavlinkBridge() {
  const mavlinkUrl = useAgentConnectionStore((s) => s.mavlinkUrl);
  const connected = useAgentConnectionStore((s) => s.connected);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const status = useAgentSystemStore((s) => s.status);
  const fcConnected = status?.fc_connected ?? false;
  const connectingRef = useRef(false);
  const connectedDroneIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Need at least: agent connected + FC connected + (mavlinkUrl OR cloudDeviceId for MQTT)
    if (!connected || !fcConnected || connectingRef.current) return;
    if (!mavlinkUrl && !cloudDeviceId) return;

    // DEC-108 Phase E: skip the MQTT MAVLink relay path on localhost dev mode
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
    if (isLocalDev && !mavlinkUrl) {
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
      try {
        const { MAVLinkAdapter } = await import("@/lib/protocol/mavlink-adapter");

        if (cancelled) return;

        let transport: Transport | undefined;
        let connType: "websocket" | "mqtt-mavlink" = "websocket";

        // Try 1: Direct WebSocket (LAN, lowest latency)
        if (mavlinkUrl) {
          try {
            const { WebSocketTransport } = await import("@/lib/protocol/transport/websocket");
            const wsTransport = new WebSocketTransport();
            await Promise.race([
              wsTransport.connect(mavlinkUrl),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("timeout")), WS_TIMEOUT_MS),
              ),
            ]);
            transport = wsTransport;
            console.log("[AgentMavlinkBridge] Direct WebSocket connected");
          } catch {
            console.log("[AgentMavlinkBridge] Direct WS failed, trying MQTT relay...");
          }
        }

        // Try 2: MQTT relay (cloud, works from anywhere)
        if (!transport && cloudDeviceId) {
          try {
            const { MqttMavlinkTransport } = await import(
              "@/lib/protocol/transport/mqtt-mavlink"
            );
            const mqttTransport = new MqttMavlinkTransport();
            await mqttTransport.connect(cloudDeviceId);
            transport = mqttTransport;
            connType = "mqtt-mavlink";
            console.log("[AgentMavlinkBridge] MQTT relay connected");
          } catch (mqttErr) {
            console.warn("[AgentMavlinkBridge] MQTT relay failed:", mqttErr);
          }
        }

        if (!transport) {
          console.warn("[AgentMavlinkBridge] All MAVLink connection methods failed");
          return;
        }

        if (cancelled) {
          transport.disconnect();
          return;
        }

        const adapter = new MAVLinkAdapter();
        const vehicleInfo = await adapter.connect(transport);

        if (cancelled) {
          adapter.disconnect();
          transport.disconnect();
          return;
        }

        const droneId = cloudDeviceId ? `agent-${cloudDeviceId}` : `agent-${Date.now()}`;
        const droneName = status?.board?.name
          ? `${status.board.name} (via Agent)`
          : "Drone (via Agent)";

        useDroneManager.getState().addDrone(
          droneId,
          droneName,
          adapter,
          transport,
          vehicleInfo,
          { type: connType, url: mavlinkUrl || undefined },
        );

        connectedDroneIdRef.current = droneId;
        console.log(`[AgentMavlinkBridge] MAVLink connected via ${connType}:`, droneId);
      } catch (err) {
        console.warn("[AgentMavlinkBridge] MAVLink connection failed:", err);
      } finally {
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
  }, [mavlinkUrl, connected, fcConnected, cloudDeviceId, status?.board?.name]);

  return null;
}
