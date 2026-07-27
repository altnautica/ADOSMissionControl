/**
 * @module AgentConnectionStoreTypes
 * @description Shared types for the agent connection store slices.
 * @license GPL-3.0-only
 */

import type { StateCreator } from "zustand";
import type { AgentClient } from "@/lib/agent/client";
import type { AgentStatus } from "@/lib/agent/types";

/**
 * Why a locally-paired card could not connect even though the box is reachable:
 * the stored identity no longer matches the agent at that host. Drives the
 * truthful "re-pair / remove" empty state instead of the misleading
 * "connect a flight controller" (USB) prompt.
 */
export type StalePairingReason =
  /** The agent at this host reports a different device id (re-flashed). */
  | "reidentified"
  /** The agent reports itself unpaired (cleared from its webapp / CLI). */
  | "unpaired";

export interface StalePairingInfo {
  reason: StalePairingReason;
  /** The base URL the stale card points at. */
  host: string;
  /** The stored (now-stale) device id of the card. */
  deviceId: string;
  /** What the agent reports as its identity now, when known. */
  liveDeviceId: string | null;
}

/**
 * Local agent state: REST URL, API key, polling lifecycle, failure cascade.
 */
export interface LocalState {
  agentUrl: string | null;
  apiKey: string | null;
  connected: boolean;
  client: AgentClient | null;
  connectionError: string | null;
  pollInterval: ReturnType<typeof setInterval> | null;
  /** Consecutive poll failures. Used by the local-mode staleness cascade. */
  consecutiveFailures: number;
  /** MAVLink WebSocket URL derived from agent heartbeat or direct connection. */
  mavlinkUrl: string | null;
  /** Stable device identity of the focused node, set on every connect path
   * (local LAN, cloud relay). Mode-independent; the MAVLink bridge derives a
   * deterministic fleet-card id from it instead of minting a timestamp id. */
  nodeDeviceId: string | null;
  /** Set when a connect attempt against a locally-paired card failed because
   * the box at its host is reachable but is no longer the paired agent the
   * card remembers (re-flashed → new device id, or unpaired). Null whenever a
   * connection is live or the failure was a plain offline/transient one. */
  stalePairing: StalePairingInfo | null;
  /** Control-plane round-trip time to the agent in milliseconds, measured on
   * the LAN-direct poll (the GET /api/ping echo, or the status request when
   * ping is unavailable). Null until the first successful measurement, or in
   * cloud-relay mode where there is no direct timing surface. */
  controlRttMs: number | null;
}

/**
 * Cloud-mode state: device ID, MQTT readiness, last cloud heartbeat.
 */
export interface CloudState {
  cloudMode: boolean;
  cloudDeviceId: string | null;
  mqttConnected: boolean;
  lastCloudUpdate: number | null;
}

/**
 * Local-state setters and the staleness cascade callbacks.
 */
export interface LocalActions {
  setApiKey: (key: string | null) => void;
  setMavlinkUrl: (url: string | null) => void;
  /** Record a fresh control-plane RTT measurement (ms). */
  setControlRttMs: (rttMs: number | null) => void;
  noteFetchSuccess: () => void;
  noteFetchFailure: () => void;
}

/**
 * Cloud-mode setters and command relay.
 */
export interface CloudActions {
  connectCloud: (deviceId: string) => void;
  sendCloudCommand: (command: string, args?: Record<string, unknown>) => void;
  setCloudStatus: (status: AgentStatus, dataTimestamp?: number) => void;
  setMqttConnected: (connected: boolean) => void;
}

/**
 * Connection lifecycle: client construction, polling, teardown.
 */
export interface ClientManagerActions {
  connect: (
    url: string,
    apiKey?: string | null,
    deviceId?: string | null,
    /** `relay: true` when `url` is a ground station's relay-proxy prefix
     *  rather than the agent's own origin. */
    opts?: { relay?: boolean },
  ) => Promise<void>;
  disconnect: () => void;
  startPolling: () => void;
  stopPolling: () => void;
  clear: () => void;
}

export type LocalStateSlice = LocalState & LocalActions;
export type CloudStateSlice = CloudState & CloudActions;
export type ClientManagerSlice = ClientManagerActions;

export type AgentConnectionStore =
  & LocalStateSlice
  & CloudStateSlice
  & ClientManagerSlice;

export type AgentConnectionSliceCreator<T> = StateCreator<
  AgentConnectionStore,
  [],
  [],
  T
>;

/** Cap for CPU/memory ring history buffers in the system store. */
export const MAX_CPU_HISTORY = 60;
