"use client";

/**
 * @module MqttBridge
 * @description MQTT client bridge -- connects to Mosquitto via WebSocket and
 * pumps real-time telemetry into the agent store.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useAgentPeripheralsStore } from "@/stores/agent-peripherals-store";
import { useFleetNetworkStore } from "@/stores/fleet-network-store";
import { usePairingStore } from "@/stores/pairing-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { resolveLanAgentUrl } from "@/stores/agent-connection/cloud-state";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";
import { parseWireDetectionJson } from "@/lib/agent/vision-detections-ws";
import {
  usePluginUpdateStore,
  type PluginUpdateReason,
} from "@/stores/plugin-update-store";
import { useToast } from "@/components/ui/toast";
import type { AgentStatus } from "@/lib/agent/types";
import { OFFICIAL_MQTT_WS_URL } from "@/lib/config/endpoints";
import { getMqttBrokerCredential } from "@/lib/mqtt-broker-credential";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";

const MQTT_WS_URL_DEFAULT = OFFICIAL_MQTT_WS_URL;

export function MqttBridge({
  mqttBrokerUrl,
}: {
  mqttBrokerUrl?: string | null;
}) {
  // Not the credential itself, only a counter that changes when it does. The
  // credential is read at connect time from the singleton every MQTT client
  // shares, so it never travels through props; this is what makes the effect
  // re-run once it lands.
  const credentialEpoch = useMqttControlGrantStore((s) => s.credentialEpoch);
  const cloudDeviceId = useAgentConnectionStore((s) => s.cloudDeviceId);
  const setCloudStatus = useAgentConnectionStore((s) => s.setCloudStatus);
  const setMqttConnected = useAgentConnectionStore((s) => s.setMqttConnected);
  // The fleet-wide MQTT bridge already subscribes to the telemetry topic for
  // every paired drone and writes it into the fleet store. When the selected
  // agent is one of those paired drones we let that bridge own the telemetry
  // topic and skip it here, so the same telemetry isn't ingested twice into
  // two stores. The status + plugin-update topics stay ours (the fleet bridge
  // doesn't handle them).
  const selectedIsPaired = usePairingStore((s) =>
    cloudDeviceId
      ? s.pairedDrones.some((d) => d.deviceId === cloudDeviceId)
      : false,
  );
  // Detections reach the store over the LAN WebSocket (`VisionDetectionsBridge`)
  // whenever a LAN path resolves. When it does NOT — a hosted/HTTPS cockpit
  // (mixed-content blocks `ws://` to a private LAN host) or a drone with no LAN
  // pairing — the cloud-relay `vision/detections` topic is the only path, so we
  // subscribe to it only then. Prefers LAN (never double-feeds the store).
  const nodes = useLocalNodesStore((s) => s.nodes);
  const visionViaCloud = useMemo(() => {
    if (!cloudDeviceId) return false;
    // `nodes` is the reactivity trigger; the resolver reads the same store.
    return resolveLanAgentUrl(cloudDeviceId) == null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudDeviceId, nodes]);
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
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

        // Pass the operator's broker credential when one has been minted. The
        // grant is scoped to the drones this operator owns, so it subscribes to
        // exactly the telemetry they are entitled to. When it is absent (bench
        // broker / OSS self-host with anonymous mode, or a signed-out visitor)
        // connect without a username so the anonymous path keeps working.
        const connectOptions: Record<string, unknown> = {
          protocolVersion: 5,
          clean: true,
          reconnectPeriod: 5000,
        };
        const cred = getMqttBrokerCredential();
        if (cred) {
          connectOptions.username = cred.username;
          connectOptions.password = cred.password;
        }
        const client = (connectFn as typeof mqttModule.connect)(
          mqttBrokerUrl || MQTT_WS_URL_DEFAULT,
          connectOptions,
        );

        clientRef.current = client;

        // mqtt.js fires 'connect' on every (re)connect with the broker.
        // We resubscribe each time because the previous session's
        // subscriptions are dropped on a `clean: true` reconnect.
        // Cast loosely because the dynamic-import client type omits the
        // (topic, callback) subscribe overload.
        const c = client as unknown as {
          on: (event: string, cb: (...args: unknown[]) => void) => void;
          subscribe: (
            topic: string,
            cb: (err: Error | null) => void,
          ) => void;
        };
        c.on("connect", () => {
          if (cancelled) return;
          setMqttConnected(true);
          const onSubErr = (err: Error | null) => {
            if (err) {
              console.warn(
                "[MqttBridge] subscribe failed:",
                err.message,
              );
            }
          };
          c.subscribe(`ados/${cloudDeviceId}/status`, onSubErr);
          // Skip telemetry for paired drones — the fleet-wide bridge owns it.
          if (!selectedIsPaired) {
            c.subscribe(`ados/${cloudDeviceId}/telemetry`, onSubErr);
          }
          c.subscribe(
            `ados/${cloudDeviceId}/plugin/update_available`,
            onSubErr,
          );
          // Vision detections only when there is no LAN WebSocket path (LAN
          // wins; this is the hosted/HTTPS or no-LAN-pairing fallback).
          if (visionViaCloud) {
            c.subscribe(`ados/${cloudDeviceId}/vision/detections`, onSubErr);
          }
        });

        c.on("close", () => {
          if (!cancelled) setMqttConnected(false);
        });

        c.on("reconnect", () => {
          if (!cancelled) console.debug("[MqttBridge] reconnecting");
        });

        client.on("message", (topic: string, payload: Buffer) => {
          if (cancelled) return;

          // Vision detection batches arrive on a dedicated topic (the same
          // contract JSON the LAN WebSocket forwards). Map + route into the
          // SAME store `setBatch` the LAN bridge feeds, so the overlay, box
          // smoothing, and perception-health surfaces all light up unchanged.
          if (topic.endsWith("/vision/detections")) {
            const batch = parseWireDetectionJson(payload.toString());
            if (batch) {
              useVisionDetectionsStore
                .getState()
                .setBatch(cloudDeviceId as string, batch);
            }
            return;
          }

          // Plugin auto-update events arrive on a dedicated topic. The
          // agent emits a fresh event each time its registry sweep
          // finds an update that the auto-update loop will not apply
          // automatically (major bump, new permissions, board mismatch,
          // or version pin). The GCS surfaces the event as a toast and
          // a per-plugin badge.
          if (topic.endsWith("/plugin/update_available")) {
            try {
              const data = JSON.parse(payload.toString());
              if (
                typeof data.plugin_id !== "string" ||
                typeof data.current_version !== "string" ||
                typeof data.latest_version !== "string"
              ) {
                return;
              }
              const reason = (
                ["major_bump", "permission_delta", "board_mismatch", "pinned"].includes(
                  data.reason,
                )
                  ? data.reason
                  : "major_bump"
              ) as PluginUpdateReason;
              usePluginUpdateStore.getState().addUpdate({
                deviceId: cloudDeviceId as string,
                pluginId: data.plugin_id,
                currentVersion: data.current_version,
                latestVersion: data.latest_version,
                reason,
                newPermissions: Array.isArray(data.new_permissions)
                  ? data.new_permissions
                  : [],
                timestamp:
                  typeof data.timestamp_ms === "number"
                    ? data.timestamp_ms
                    : Date.now(),
              });
              toastRef.current(
                `Plugin update available: ${data.plugin_id} v${data.current_version} -> v${data.latest_version}`,
                "info",
              );
            } catch (e) {
              console.warn("[MqttBridge] failed to parse plugin update event:", e);
            }
            return;
          }

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
                  // A reading the payload omitted stays absent, so the gauges
                  // read unknown rather than a confident 0%.
                  cpu_percent: typeof data.cpuPercent === "number" ? data.cpuPercent : undefined,
                  memory_percent: typeof data.memoryPercent === "number" ? data.memoryPercent : undefined,
                  disk_percent: typeof data.diskPercent === "number" ? data.diskPercent : undefined,
                  temperature: data.temperature ?? null,
                  timestamp: new Date().toISOString(),
                },
                fc_connected: data.fcConnected || false,
                fc_port: data.fcPort || "",
                fc_baud: data.fcBaud || 0,
              };
              setCloudStatus(mapped);

              // Synthesize resources from health data. This payload carries
              // percentages only, so the byte capacities are left absent
              // instead of reported as "0 / 0 MB", which reads as a node with
              // no memory rather than one that did not send the figure.
              useAgentSystemStore.setState({
                resources: {
                  cpu_percent: mapped.health.cpu_percent,
                  memory_percent: mapped.health.memory_percent,
                  memory_used_mb: undefined,
                  memory_total_mb: undefined,
                  memory_available_mb: 0,
                  memory_cache_mb: 0,
                  swap_total_mb: 0,
                  swap_used_mb: 0,
                  swap_percent: 0,
                  disk_percent: mapped.health.disk_percent,
                  disk_used_gb: undefined,
                  disk_total_gb: undefined,
                  temperature: mapped.health.temperature,
                },
              });

              // Map services if present in MQTT payload
              if (data.services && Array.isArray(data.services)) {
                useAgentSystemStore.setState({
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

              // Map extended status fields to their respective stores
              if (data.peripherals && Array.isArray(data.peripherals)) {
                useAgentPeripheralsStore.setState({ peripherals: data.peripherals });
              }
              if (data.peers && Array.isArray(data.peers)) {
                useFleetNetworkStore.setState({ peers: data.peers });
              }
              if (data.enrollment && typeof data.enrollment === "object") {
                useFleetNetworkStore.setState({ enrollment: data.enrollment });
              }
              if (data.logs && Array.isArray(data.logs)) {
                useAgentSystemStore.setState({ logs: data.logs });
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
  }, [
    cloudDeviceId,
    selectedIsPaired,
    visionViaCloud,
    // The broker URL is resolved from clientConfig and the credential from the
    // grant the operator mints, both of which land a tick or more after the
    // first render. Without them in the deps the initial connect would fire
    // credential-less (to the default broker) and never re-run, so cloud status
    // and the cloud-relay vision-detections topic would silently never connect.
    // Both settle once and are then stable, so this tears down + reconnects
    // exactly once per change (no per-render thrash).
    mqttBrokerUrl,
    credentialEpoch,
    setCloudStatus,
    setMqttConnected,
  ]);

  return null;
}
