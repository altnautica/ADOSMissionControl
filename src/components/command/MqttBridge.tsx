"use client";

/**
 * @module MqttBridge
 * @description MQTT client bridge -- connects to the deployment's broker via
 * WebSocket for the focused cloud node's status, plugin-update and (without a
 * LAN path) vision-detection topics. It dials only the broker the deployment
 * configured; with none there is no MQTT at all.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef } from "react";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { resolveLanAgentUrl } from "@/lib/agent/resolve-agent";
import { useVisionDetectionsStore } from "@/stores/vision-detections-store";
import { ingestCloudDetections } from "@/lib/agent/vision-detections-ws";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import {
  usePluginUpdateStore,
  type PluginUpdateReason,
} from "@/stores/plugin-update-store";
import { useToast } from "@/components/ui/toast";
import { getMqttBrokerCredential } from "@/lib/mqtt-broker-credential";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";

/**
 * Fold one agent MQTT status document into the focused node's status. The
 * agent publishes `{ device_id, name, tier, armed, fc_connected,
 * mavlink_alive, heartbeat_age_s }` at its telemetry rate: the fast FC-link
 * truth, and nothing else. Those fields overlay the status the cloud
 * heartbeat built; everything the document does not carry (board, health,
 * services, FC variant, transport state) stays as the heartbeat reported it.
 * Before the first heartbeat there is no status to overlay, and a document
 * for another device is ignored. Returns whether the status changed.
 */
export function applyMqttStatusDoc(deviceId: string, raw: unknown): boolean {
  if (raw === null || typeof raw !== "object") return false;
  const doc = raw as Record<string, unknown>;
  if (doc.device_id !== deviceId) return false;
  const current = useAgentSystemStore.getState().status;
  if (!current) return false;
  const next = { ...current };
  if (typeof doc.fc_connected === "boolean") next.fc_connected = doc.fc_connected;
  if (typeof doc.mavlink_alive === "boolean") next.mavlink_alive = doc.mavlink_alive;
  if (doc.heartbeat_age_s === null || typeof doc.heartbeat_age_s === "number") {
    next.heartbeat_age_s = doc.heartbeat_age_s;
  }
  // The status record's freshness stamp stays the heartbeat's: only the FC
  // fields are this recent.
  useAgentSystemStore.setState({ status: next });
  return true;
}

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
  const setMqttConnected = useAgentConnectionStore((s) => s.setMqttConnected);
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
  // Set once the client exists; releases subscriptions, listeners and socket.
  const teardownRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    // No configured broker, no dial: never a broker the operator did not choose.
    if (!cloudDeviceId || !mqttBrokerUrl) return;
    const brokerUrl = mqttBrokerUrl;

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
          brokerUrl,
          connectOptions,
        );

        clientRef.current = client;

        // mqtt.js fires 'connect' on every (re)connect with the broker.
        // We resubscribe each time because the previous session's
        // subscriptions are dropped on a `clean: true` reconnect.
        // Cast loosely because the dynamic-import client type omits the
        // (topicObject, callback) subscribe overload.
        const c = client as unknown as {
          on: (event: string, cb: (...args: unknown[]) => void) => void;
          removeAllListeners: () => void;
          subscribe: (
            topics: Record<string, { qos: 0 | 1 | 2 }>,
            cb: (err: Error | null) => void,
          ) => void;
          unsubscribe: (topics: string[], cb?: (err?: Error) => void) => void;
          end: (force?: boolean) => void;
        };

        // The subscription SET, computed once from the effect's own inputs.
        //
        // QoS is split by what a lost message costs. Status and plugin-update
        // are discrete control-plane events — a dropped status leaves the node
        // card reading the previous state until the next emission, and a
        // dropped update event is simply never seen — so they take QoS 1.
        // Detection batches are a continuous stream where the next batch
        // supersedes the last within a frame, so QoS 1's acknowledgement round
        // trip would buy latency for nothing.
        const subscriptions: Record<string, { qos: 0 | 1 | 2 }> = {
          [`ados/${cloudDeviceId}/status`]: { qos: 1 },
          [`ados/${cloudDeviceId}/plugin/update_available`]: { qos: 1 },
        };
        // Vision detections only when there is no LAN WebSocket path (LAN
        // wins; this is the hosted/HTTPS or no-LAN-pairing fallback).
        if (visionViaCloud) {
          subscriptions[`ados/${cloudDeviceId}/vision/detections`] = { qos: 0 };
        }
        const subscribedTopics = Object.keys(subscriptions);

        teardownRef.current = () => {
          try {
            c.unsubscribe(subscribedTopics);
          } catch {
            /* a client already closed by the broker has nothing to release */
          }
          try {
            c.removeAllListeners();
          } catch {
            /* ignore */
          }
          try {
            c.end(true);
          } catch {
            /* ignore */
          }
        };

        c.on("connect", () => {
          if (cancelled) return;
          setMqttConnected(true);
          // ONE SUBSCRIBE packet carrying the whole set, rather than three or
          // four sequential calls. The broker replaces any existing
          // subscription for the same filter, so re-running this on every
          // reconnect is idempotent by construction — and a single packet
          // cannot interleave with a reconnect partway through the set and
          // leave the client subscribed to some topics and not others.
          c.subscribe(subscriptions, (err: Error | null) => {
            if (!err) return;
            console.warn("[MqttBridge] subscribe failed:", err.message);
            // A failed subscribe means this client is connected but deaf. Say
            // so rather than leaving the surface reading "connected" while no
            // message will ever arrive.
            if (!cancelled) {
              setMqttConnected(false);
              toastRef.current(
                "Cloud telemetry subscription failed; the broker refused it.",
                "error",
              );
            }
          });
        });

        // mqtt.js emits 'error' on a broker outage, a refused connection and a
        // rejected credential. Client extends EventEmitter, so an 'error' with
        // NO listener is rethrown as an uncaught exception — a broker going
        // down took out the page rather than degrading. The client keeps its
        // own reconnect timer, so this reports and lets it retry.
        c.on("error", (...args: unknown[]) => {
          const err = args[0];
          const message = err instanceof Error ? err.message : String(err);
          console.warn("[MqttBridge] client error:", message);
          if (!cancelled) setMqttConnected(false);
        });

        c.on("offline", () => {
          if (!cancelled) setMqttConnected(false);
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
          // contract JSON the LAN WebSocket forwards). Route them into the
          // SAME store `setBatch` the LAN bridge feeds, under the node id the
          // overlay, box smoothing and perception-health surfaces read with.
          if (topic.endsWith("/vision/detections")) {
            ingestCloudDetections(cloudDeviceId as string, payload.toString());
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

          if (topic.endsWith("/status")) {
            try {
              applyMqttStatusDoc(cloudDeviceId as string, JSON.parse(payload.toString()));
            } catch { /* ignore parse errors */ }
          }
        });
      } catch (err) {
        console.warn("MQTT connection failed:", err);
      }
    }

    connectMqtt();

    return () => {
      cancelled = true;
      const teardown = teardownRef.current;
      teardownRef.current = null;
      clientRef.current = null;
      // Explicit release, in order: drop the broker-side subscriptions, drop
      // every local listener, then force the socket shut.
      //
      // The previous teardown called `end()` alone. That leaves the client's
      // listeners attached while it drains, so an 'error' or a late 'message'
      // arriving during the graceful close still ran handlers that write into
      // stores — for a device the component has already stopped tracking. With
      // `cloudDeviceId` in the deps this effect re-runs on every node switch,
      // so that is one leaked listener set per switch.
      teardown?.();
      setMqttConnected(false);
      // This stream fed the node's detections; none of them are live now.
      if (cloudDeviceId) {
        useVisionDetectionsStore.getState().clearBatch(nodeIdForDevice(cloudDeviceId));
      }
    };
  }, [
    cloudDeviceId,
    visionViaCloud,
    // The broker URL is resolved from clientConfig and the credential from the
    // grant the operator mints, both of which land a tick or more after the
    // first render. Without them in the deps the bridge would never dial once
    // the URL resolved, and a credential landing later would never be used.
    // Both settle once and are then stable, so this tears down + reconnects
    // exactly once per change (no per-render thrash).
    mqttBrokerUrl,
    credentialEpoch,
    setMqttConnected,
  ]);

  return null;
}
