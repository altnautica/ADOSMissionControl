"use client";

/**
 * @module CommandFleetMqttBridge
 * @description Subscribes to telemetry topics for all paired Command agents on
 * the deployment's configured broker, once the operator's broker credential
 * has been minted. With no configured broker or no credential it dials
 * nothing.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef } from "react";
import type { PairedDrone } from "@/stores/pairing-store";
import { useCommandFleetStore, type CommandTelemetrySnapshot } from "@/stores/command-fleet-store";
import { getMqttBrokerCredential } from "@/lib/mqtt-broker-credential";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";

type MqttClient = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  subscribe: (topic: string, cb?: (err: Error | null) => void) => void;
  end: (force?: boolean) => void;
};

export function CommandFleetMqttBridge({
  pairedDrones,
  mqttBrokerUrl,
}: {
  pairedDrones: PairedDrone[];
  mqttBrokerUrl?: string | null;
}) {
  // A counter, not the credential. The credential is read at connect time from
  // the singleton every MQTT client shares; this is only what tells the effect
  // the one it dialled with has been replaced.
  const credentialEpoch = useMqttControlGrantStore((s) => s.credentialEpoch);
  const deviceIds = useMemo(
    () => pairedDrones.map((drone) => drone.deviceId).sort(),
    [pairedDrones],
  );
  const clientRef = useRef<MqttClient | null>(null);

  useEffect(() => {
    if (deviceIds.length === 0) return;
    // Only the broker the deployment configured, and only as the operator:
    // an anonymous dial to a broker that requires auth is refused on every
    // reconnect. The credential epoch in the deps re-runs this once it lands.
    const cred = getMqttBrokerCredential();
    if (!mqttBrokerUrl || !cred) return;
    const brokerUrl = mqttBrokerUrl;
    const { username, password } = cred;
    let cancelled = false;

    async function connectMqtt() {
      try {
        const mqttModule = await import("mqtt");
        if (cancelled) return;
        const connectFn = mqttModule.connect
          ?? (mqttModule.default as { connect?: typeof mqttModule.connect })?.connect
          ?? mqttModule.default;
        if (typeof connectFn !== "function") {
          throw new Error("mqtt.connect not found in module");
        }

        const connectOptions: Record<string, unknown> = {
          protocolVersion: 5,
          clean: true,
          reconnectPeriod: 5000,
          username,
          password,
        };
        const client = (connectFn as typeof mqttModule.connect)(
          brokerUrl,
          connectOptions,
        ) as unknown as MqttClient & {
          on: (event: "message", cb: (topic: string, payload: { toString: () => string }) => void) => void;
        };
        clientRef.current = client;

        client.on("connect", () => {
          if (cancelled) return;
          for (const deviceId of deviceIds) {
            client.subscribe(`ados/${deviceId}/telemetry`, (err) => {
              if (err) {
                console.warn("[CommandFleetMqttBridge] subscribe failed:", err.message);
              }
            });
          }
        });

        // mqtt.js emits 'error' on a refused CONNACK and on connack/keepalive
        // timeouts. Client extends EventEmitter, so an 'error' with no
        // listener is rethrown as an uncaught exception. The client keeps its
        // own reconnect timer, so this reports and lets it retry.
        client.on("error", (...args: unknown[]) => {
          const err = args[0];
          console.warn(
            "[CommandFleetMqttBridge] client error:",
            err instanceof Error ? err.message : String(err),
          );
        });
        // The link is down: the last readings describe nothing live.
        const dropTelemetry = () => {
          if (!cancelled) useCommandFleetStore.getState().clearTelemetry(deviceIds);
        };
        client.on("offline", dropTelemetry);
        client.on("close", dropTelemetry);

        client.on("message", (topic, payload) => {
          if (cancelled) return;
          const match = topic.match(/^ados\/([^/]+)\/telemetry$/);
          if (!match) return;
          try {
            const parsed = JSON.parse(payload.toString()) as CommandTelemetrySnapshot;
            useCommandFleetStore.getState().setTelemetry(match[1], parsed);
          } catch { /* ignore malformed telemetry */ }
        });
      } catch (err) {
        console.warn("[CommandFleetMqttBridge] connection failed:", err);
      }
    }

    connectMqtt();

    return () => {
      cancelled = true;
      clientRef.current?.end(true);
      clientRef.current = null;
      // The stream this effect fed is closed, so its last readings describe
      // nothing live any more. Drop them rather than let them outlive the link.
      useCommandFleetStore.getState().clearTelemetry(deviceIds);
    };
    // The credential epoch belongs here for the same reason the broker URL does:
    // both arrive after the first render, and an effect that ignored them would
    // dial anonymously once and never retry, leaving every paired drone's
    // telemetry row empty on a broker that requires auth.
  }, [deviceIds, mqttBrokerUrl, credentialEpoch]);

  return null;
}
