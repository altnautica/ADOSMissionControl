"use client";

/**
 * @module AgentMavlinkBridge
 * @description Automatically establishes a MAVLink WebSocket connection to the
 * ADOS Drone Agent's MAVLink proxy when a mavlinkUrl is available and the agent
 * reports an FC connected. Once connected, calls DroneManager.addDrone() which
 * activates all GCS features (telemetry, config panels, mission planning, etc.).
 * Renders nothing — pure bridge component.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useDroneManager } from "@/stores/drone-manager";

export function AgentMavlinkBridge() {
  const mavlinkUrl = useAgentConnectionStore((s) => s.mavlinkUrl);
  const connected = useAgentConnectionStore((s) => s.connected);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const status = useAgentSystemStore((s) => s.status);
  const fcConnected = status?.fc_connected ?? false;
  const connectingRef = useRef(false);
  const connectedDroneIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mavlinkUrl || !connected || !fcConnected || connectingRef.current) return;

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
        const { WebSocketTransport } = await import("@/lib/protocol/transport/websocket");
        const { MAVLinkAdapter } = await import("@/lib/protocol/mavlink-adapter");

        if (cancelled) return;

        const transport = new WebSocketTransport();
        await transport.connect(mavlinkUrl!);

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
          { type: "websocket", url: mavlinkUrl! },
        );

        connectedDroneIdRef.current = droneId;
        console.log("[AgentMavlinkBridge] MAVLink connected:", droneId, mavlinkUrl);
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
      // Cleanup: remove drone on unmount or dependency change
      if (connectedDroneIdRef.current) {
        useDroneManager.getState().disconnectDrone(connectedDroneIdRef.current);
        connectedDroneIdRef.current = null;
      }
    };
  }, [mavlinkUrl, connected, fcConnected, cloudDeviceId, status?.board?.name]);

  return null;
}
