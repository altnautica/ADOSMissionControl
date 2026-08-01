"use client";

/**
 * @module use-mqtt-config
 * @description State and connection-test logic for the MQTT broker config form
 * inside the System tab Fleet Network section. Encapsulates broker mode (cloud
 * vs self-hosted), credentials, TLS toggle, and async test state so the UI
 * component stays presentational.
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";

import { OFFICIAL_MQTT_HOST } from "@/lib/config/endpoints";

export type MqttMode = "cloud" | "self-hosted";

export interface MqttConfig {
  mode: MqttMode;
  brokerUrl: string;
  username: string;
  password: string;
  tls: boolean;
}

export interface MqttTestResult {
  ok: boolean;
  message: string;
  at: number;
}

const DEFAULT_CONFIG: MqttConfig = {
  mode: "cloud",
  brokerUrl: OFFICIAL_MQTT_HOST,
  username: "",
  password: "",
  tls: true,
};

/** How long to wait for the broker probe before declaring it unreachable. */
const PROBE_TIMEOUT_MS = 5000;

/**
 * GCS connects to MQTT over a WebSocket URL, so the honest in-browser probe
 * is a real WebSocket dial to that endpoint (the app has no raw TCP socket
 * in the renderer). Derive the WebSocket URL from the user's broker field:
 * a bare host[:port] becomes ws(s)://host[:port]/mqtt, an http(s) URL is
 * scheme-swapped, and an existing ws(s) URL is used verbatim.
 */
function deriveMqttWsUrl(broker: string, tls: boolean): string {
  const trimmed = broker.trim();
  if (/^wss?:\/\//i.test(trimmed)) return trimmed;
  const http = /^(https?):\/\/(.+)$/i.exec(trimmed);
  if (http) return `${tls ? "wss" : "ws"}://${http[2]}`;
  if (!trimmed) return "";
  return `${tls ? "wss" : "ws"}://${trimmed}/mqtt`;
}

/**
 * Probe the broker by opening a WebSocket with a timeout, surfacing the
 * actual error. Never fabricates a green result: reports only what the
 * dial observed. Falls back to `ok:false` with an explicit "not
 * implemented" message when no WebSocket probe is feasible, so the form
 * never lies.
 */
function probeBroker(wsUrl: string): Promise<{ ok: boolean; message: string }> {
  const { promise, resolve } = Promise.withResolvers<{ ok: boolean; message: string }>();
  if (!wsUrl || typeof WebSocket === "undefined") {
    resolve({ ok: false, message: "Connection test not yet implemented" });
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


export interface UseMqttConfigResult {
  config: MqttConfig;
  setMode: (mode: MqttMode) => void;
  setBrokerUrl: (url: string) => void;
  setUsername: (user: string) => void;
  setPassword: (pwd: string) => void;
  setTls: (tls: boolean) => void;
  testConnection: () => Promise<void>;
  isTesting: boolean;
  lastResult: MqttTestResult | null;
}

/**
 * Manage MQTT broker configuration state and a stub connection-test action.
 * The test currently waits 2 seconds and reports success. Wire to a real
 * agent endpoint when broker probe is available.
 */
export function useMqttConfig(initial?: Partial<MqttConfig>): UseMqttConfigResult {
  const [config, setConfig] = useState<MqttConfig>({ ...DEFAULT_CONFIG, ...initial });
  const [isTesting, setIsTesting] = useState(false);
  const [lastResult, setLastResult] = useState<MqttTestResult | null>(null);

  const setMode = useCallback((mode: MqttMode) => {
    setConfig((prev) => ({ ...prev, mode }));
  }, []);

  const setBrokerUrl = useCallback((brokerUrl: string) => {
    setConfig((prev) => ({ ...prev, brokerUrl }));
  }, []);

  const setUsername = useCallback((username: string) => {
    setConfig((prev) => ({ ...prev, username }));
  }, []);

  const setPassword = useCallback((password: string) => {
    setConfig((prev) => ({ ...prev, password }));
  }, []);

  const setTls = useCallback((tls: boolean) => {
    setConfig((prev) => ({ ...prev, tls }));
  }, []);

  const testConnection = useCallback(async () => {
    setIsTesting(true);
    try {
      const wsUrl = deriveMqttWsUrl(config.brokerUrl, config.tls);
      const { ok, message } = await probeBroker(wsUrl);
      setLastResult({ ok, message, at: Date.now() });
    } finally {
      setIsTesting(false);
    }
  }, [config.brokerUrl, config.tls]);

  return {
    config,
    setMode,
    setBrokerUrl,
    setUsername,
    setPassword,
    setTls,
    testConnection,
    isTesting,
    lastResult,
  };
}
