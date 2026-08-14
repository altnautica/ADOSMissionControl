"use client";

/**
 * @module CommandFleetMqttBridge
 * @description Subscribes to telemetry topics for all paired Command agents.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef } from "react";
import type { PairedDrone } from "@/stores/pairing-store";
import { useCommandFleetStore, type CommandTelemetrySnapshot } from "@/stores/command-fleet-store";
import { OFFICIAL_MQTT_WS_URL } from "@/lib/config/endpoints";
import { getMqttBrokerCredential } from "@/lib/mqtt-broker-credential";
import { useMqttControlGrantStore } from "@/stores/mqtt-control-grant-store";

const MQTT_WS_URL_DEFAULT = OFFICIAL_MQTT_WS_URL;

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
        };
        const cred = getMqttBrokerCredential();
        if (cred) {
          connectOptions.username = cred.username;
          connectOptions.password = cred.password;
        }
        const client = (connectFn as typeof mqttModule.connect)(
          mqttBrokerUrl || MQTT_WS_URL_DEFAULT,
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
    };
    // The credential epoch belongs here for the same reason the broker URL does:
    // both arrive after the first render, and an effect that ignored them would
    // dial anonymously once and never retry, leaving every paired drone's
    // telemetry row empty on a broker that requires auth.
  }, [deviceIds, mqttBrokerUrl, credentialEpoch]);

  return null;
}
