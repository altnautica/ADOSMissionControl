"use client";

/**
 * @module MqttBridge
 * @description MQTT client bridge -- connects to Mosquitto via WebSocket and
 * pumps real-time telemetry into the agent store.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentPeripheralsStore } from "@/stores/agent-peripherals-store";
import { useAgentScriptsStore } from "@/stores/agent-scripts-store";
import type { AgentStatus } from "@/lib/agent/types";

const MQTT_WS_URL_DEFAULT = "wss://mqtt.altnautica.com/mqtt";

export function MqttBridge({ mqttBrokerUrl }: { mqttBrokerUrl?: string | null }) {
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const setCloudStatus = useAgentConnectionStore((s) => s.setCloudStatus);
  const setMqttConnected = useAgentConnectionStore((s) => s.setMqttConnected);
  const clientRef = useRef<unknown>(null);

  useEffect(() => {
    if (!cloudDeviceId) return;

    let cancelled = false;

    async function connectMqtt() {
      try {
        const mqttModule = await import("mqtt");
        if (cancelled) return;

        // Handle ESM/CJS module resolution differences in production bundles
        const connectFn = mqttModule.connect
          ?? (mqttModule.default as { connect?: typeof mqttModule.connect })?.connect
          ?? mqttModule.default;
        if (typeof connectFn !== "function") {
          throw new Error("mqtt.connect not found in module");
        }

        const client = (connectFn as typeof mqttModule.connect)(mqttBrokerUrl || MQTT_WS_URL_DEFAULT, {
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

              // Synthesize resources from health data (cloud mode only has percentages)
              useAgentStore.setState({
                resources: {
                  cpu_percent: mapped.health.cpu_percent,
                  memory_percent: mapped.health.memory_percent,
                  memory_used_mb: 0,
                  memory_total_mb: 0,
                  disk_percent: mapped.health.disk_percent,
                  disk_used_gb: 0,
                  disk_total_gb: 0,
                  temperature: mapped.health.temperature,
                },
              });

              // Map services if present in MQTT payload
              if (data.services && Array.isArray(data.services)) {
                useAgentStore.setState({
                  services: data.services.map((s: Record<string, unknown>) => ({
                    name: String(s.name || "unknown"),
                    status: (["running", "stopped", "error"].includes(s.status as string) ? s.status : "stopped") as "running" | "stopped" | "error",
                    pid: typeof s.pid === "number" ? s.pid : null,
                    cpu_percent: typeof s.cpuPercent === "number" ? s.cpuPercent : 0,
                    memory_mb: typeof s.memoryMb === "number" ? s.memoryMb : 0,
                    uptime_seconds: typeof s.uptimeSeconds === "number" ? s.uptimeSeconds : 0,
                  })),
                });
              }

              // Map extended status fields
              const extended: Record<string, unknown> = {};
              if (data.peripherals && Array.isArray(data.peripherals)) {
                extended.peripherals = data.peripherals;
              }
              if (data.scripts && Array.isArray(data.scripts)) {
                extended.scripts = data.scripts;
              }
              if (data.suites && Array.isArray(data.suites)) {
                extended.suites = data.suites;
              }
              if (data.peers && Array.isArray(data.peers)) {
                extended.peers = data.peers;
              }
              if (data.enrollment && typeof data.enrollment === "object") {
                extended.enrollment = data.enrollment;
              }
              if (data.logs && Array.isArray(data.logs)) {
                extended.logs = data.logs;
              }
              if (Object.keys(extended).length > 0) {
                useAgentStore.setState(extended);
              }
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
