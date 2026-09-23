"use client";

/**
 * @module use-mqtt-broker-test
 * @description On-demand reachability test for the MQTT broker the fleet
 * bridges actually dial (`getMqttBrokerUrl()`, resolved from the client
 * config). The GCS connects to MQTT over a WebSocket, so the honest in-browser
 * probe is a real WebSocket dial to that endpoint; the result reports only
 * what the dial observed.
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";

import { getMqttBrokerUrl } from "@/lib/mqtt-broker-credential";

export interface MqttTestResult {
  ok: boolean;
  message: string;
  at: number;
}

/** How long to wait for the broker probe before declaring it unreachable. */
const PROBE_TIMEOUT_MS = 5000;

/** Open a WebSocket to `wsUrl` with a timeout, surfacing the actual error. */
function probeBroker(wsUrl: string): Promise<{ ok: boolean; message: string }> {
  const { promise, resolve } = Promise.withResolvers<{ ok: boolean; message: string }>();
  if (typeof WebSocket === "undefined") {
    resolve({ ok: false, message: "This browser cannot open a WebSocket" });
    return promise;
  }
  let settled = false;
  let socket: WebSocket;
  try {
    socket = new WebSocket(wsUrl);
  } catch (err) {
    resolve({
      ok: false,
      message: `Invalid broker URL: ${err instanceof Error ? err.message : String(err)}`,
    });
    return promise;
  }
  const finish = (ok: boolean, message: string) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    try {
      socket.close();
    } catch {
      // already closed
    }
    resolve({ ok, message });
  };
  const timer = setTimeout(() => finish(false, "Connection test timed out"), PROBE_TIMEOUT_MS);
  socket.onopen = () => finish(true, "Connection established");
  socket.onerror = () =>
    finish(false, "Broker unreachable (connection refused or DNS failure)");
  socket.onclose = (ev) =>
    finish(
      false,
      ev.reason
        ? `Broker closed the connection: ${ev.reason}`
        : `Broker closed the connection (code ${ev.code})`,
    );
  return promise;
}

export interface UseMqttBrokerTestResult {
  /** The broker WebSocket URL the fleet bridges dial. */
  brokerUrl: string;
  testConnection: () => Promise<void>;
  isTesting: boolean;
  lastResult: MqttTestResult | null;
}

export function useMqttBrokerTest(): UseMqttBrokerTestResult {
  const brokerUrl = getMqttBrokerUrl();
  const [isTesting, setIsTesting] = useState(false);
  const [lastResult, setLastResult] = useState<MqttTestResult | null>(null);

  const testConnection = useCallback(async () => {
    setIsTesting(true);
    try {
      const { ok, message } = await probeBroker(brokerUrl);
      setLastResult({ ok, message, at: Date.now() });
    } finally {
      setIsTesting(false);
    }
  }, [brokerUrl]);

  return { brokerUrl, testConnection, isTesting, lastResult };
}
