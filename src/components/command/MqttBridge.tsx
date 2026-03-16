"use client";

/**
 * @module MqttBridge
 * @description MQTT client bridge -- connects to Mosquitto via WebSocket and
 * pumps real-time telemetry into the agent store.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useAgentStore } from "@/stores/agent-store";
import type { AgentStatus } from "@/lib/agent/types";

const MQTT_WS_URL_DEFAULT = "wss://mqtt.altnautica.com/mqtt";

export function MqttBridge({ mqttBrokerUrl }: { mqttBrokerUrl?: string | null }) {
  const cloudDeviceId = useAgentStore((s) => s.cloudDeviceId);
  const setCloudStatus = useAgentStore((s) => s.setCloudStatus);
  const setMqttConnected = useAgentStore((s) => s.setMqttConnected);
  const clientRef = useRef<unknown>(null);

  useEffect(() => {
    if (!cloudDeviceId) return;

    let cancelled = false;

    async function connectMqtt() {
      try {
        const mqtt = await import("mqtt");
        if (cancelled) return;

        const client = mqtt.connect(mqttBrokerUrl || MQTT_WS_URL_DEFAULT, {
          protocolVersion: 5,
          clean: true,
          reconnectPeriod: 5000,
        });

        clientRef.current = client;

        client.on("connect", () => {
          if (cancelled) return;
          setMqttConnected(true);
          client.subscribe(`ados/${cloudDeviceId}/status`);
          client.subscribe(`ados/${cloudDeviceId}/telemetry`);
        });

        client.on("close", () => {
          if (!cancelled) setMqttConnected(false);
        });

        client.on("message", (_topic: string, payload: Buffer) => {
          if (cancelled) return;
          try {
            const data = JSON.parse(payload.toString());
            // Map MQTT status to AgentStatus if it has expected fields
            if (data.version || data.boardName) {
              const mapped: AgentStatus = {
                version: data.version || "?.?.?",
                uptime_seconds: data.uptimeSeconds || 0,
                board: {
                  name: data.boardName || "Unknown",
                  model: "",
                  tier: data.boardTier || 0,
                  ram_mb: 0,
                  cpu_cores: 0,
                  vendor: "",
                  soc: data.boardSoc || "",
                  arch: data.boardArch || "",
                  hw_video_codecs: [],
                },
                health: {
                  cpu_percent: data.cpuPercent || 0,
                  memory_percent: data.memoryPercent || 0,
                  disk_percent: data.diskPercent || 0,
                  temperature: data.temperature ?? null,
                  timestamp: new Date().toISOString(),
                },
                fc_connected: data.fcConnected || false,
                fc_port: data.fcPort || "",
                fc_baud: data.fcBaud || 0,
              };
              setCloudStatus(mapped);
            }
          } catch { /* ignore parse errors */ }
        });
      } catch (err) {
        console.warn("MQTT connection failed:", err);
      }
    }

    connectMqtt();

    return () => {
      cancelled = true;
      if (clientRef.current) {
        const c = clientRef.current as { end?: () => void };
        if (typeof c.end === "function") c.end();
        clientRef.current = null;
      }
      setMqttConnected(false);
    };
  }, [cloudDeviceId, setCloudStatus, setMqttConnected]);

  return null;
}
