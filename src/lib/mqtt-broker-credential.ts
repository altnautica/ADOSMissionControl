/**
 * @module mqtt-broker-credential
 * @description Process-level singleton for the MQTT broker credential used by
 * every in-browser MQTT client (MqttBridge, CommandFleetMqttBridge,
 * MqttMavlinkTransport, WebRTC signaling), and the return channel by which those
 * clients report that the broker accepted a write under it.
 *
 * The credential is the operator's own minted write grant, scoped to the drones
 * they own: `mqtt-control-grant-store` mints it, holds its plaintext for the life
 * of the tab, and injects it here. It replaced a single `gcs-viewer` password
 * shared by every operator, which granted `read ados/#` — the whole fleet's
 * telemetry to anyone holding it — and could not publish at all, so no browser
 * session could command over the relay.
 *
 * Consumers read it at connect time rather than taking it as a prop, so a
 * credential that arrives after a client has dialled reaches transports that no
 * component owns. On bench / OSS self-hosters with anonymous brokers the
 * credential stays null and connect() falls back to anonymous.
 * @license GPL-3.0-only
 */

import { OFFICIAL_MQTT_WS_URL } from "@/lib/config/endpoints";

interface MqttBrokerCredential {
  username: string;
  password: string;
}

let current: MqttBrokerCredential | null = null;
let brokerUrl: string | null = null;
let writeAcceptedFor: string | null = null;
const writeAcceptedListeners = new Set<(username: string) => void>();

/**
 * Set or clear the broker credential. Pass `null` (or an object with
 * missing username/password) to clear.
 */
export function setMqttBrokerCredential(
  next: { username?: string | null; password?: string | null } | null,
): void {
  if (next?.username && next?.password) {
    current = { username: next.username, password: next.password };
  } else {
    current = null;
  }
  // A new credential has proven nothing yet, so the next accepted publish must
  // be reported again rather than inheriting the previous principal's proof.
  writeAcceptedFor = null;
}

/**
 * Read the current broker credential. Returns `null` when no auth is
 * configured (bench / anonymous broker).
 */
export function getMqttBrokerCredential(): MqttBrokerCredential | null {
  return current;
}

/**
 * Subscribe to the first publish the broker accepted under each credential.
 * Returns an unsubscribe function.
 *
 * This exists because holding a credential and having proven it are different
 * facts, and only the publishing client can observe the second one. The grant
 * owner cannot: at QoS 0 nothing is acknowledged, so there is no round trip for
 * it to wait on.
 */
export function onBrokerWriteAccepted(
  listener: (username: string) => void,
): () => void {
  writeAcceptedListeners.add(listener);
  return () => {
    writeAcceptedListeners.delete(listener);
  };
}

/**
 * Report that the broker accepted a publish under the current credential.
 *
 * Called from the publish path, so it is on the hot path for every outbound FC
 * frame: after the first report for a credential this is one string compare and
 * no allocation.
 */
export function notifyBrokerWriteAccepted(): void {
  const username = current?.username;
  if (!username || writeAcceptedFor === username) return;
  writeAcceptedFor = username;
  for (const listener of writeAcceptedListeners) listener(username);
}

/**
 * Set or clear the broker WebSocket URL, resolved from
 * `clientConfig.mqttBrokerUrl`. Pass a falsy value to clear (fall back to
 * the managed default). CommandShell populates this once the public client
 * config is available, alongside the credential.
 */
export function setMqttBrokerUrl(url: string | null | undefined): void {
  brokerUrl = url && url.length > 0 ? url : null;
}

/**
 * Read the broker WebSocket URL every in-browser MQTT client should dial:
 * the `clientConfig`-resolved URL when set, otherwise the managed default.
 * This is the single resolution point that lets a self-hosted deployment
 * point telemetry AND WebRTC signaling at its own broker.
 */
export function getMqttBrokerUrl(): string {
  return brokerUrl ?? OFFICIAL_MQTT_WS_URL;
}
