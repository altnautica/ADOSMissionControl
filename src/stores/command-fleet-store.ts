"use client";

/**
 * @module CommandFleetStore
 * @description Per-agent Command overview data that must not overwrite the
 * focused single-agent stores.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import type { CameraUsbRecovery } from "@/lib/agent/types";

export interface CommandTelemetrySnapshot {
  armed?: boolean;
  mode?: string;
  position?: {
    lat?: number;
    lon?: number;
    alt_msl?: number;
    alt_rel?: number;
    heading?: number;
  };
  velocity?: {
    groundspeed?: number;
    airspeed?: number;
    climb?: number;
  };
  battery?: {
    voltage?: number;
    current?: number;
    remaining?: number;
  };
  gps?: {
    fix_type?: number;
    satellites?: number;
  };
  last_heartbeat?: number;
  last_update?: number;
}

/**
 * One WFB peer a node reports it is linked to. A ground node can relay more
 * than one drone, so its heartbeat carries a `linkedPeers[]` list; the legacy
 * scalar `peerDeviceId`/`peerRssiDbm` is the single-peer fallback consumed until
 * every agent ships the list.
 */
export interface LinkedPeer {
  /** The peer's stable agent device id (from the decoded WFB PresenceBeacon). */
  deviceId: string;
  /** Peer-reported RSSI in dBm (signed). Null when unknown. */
  rssiDbm?: number | null;
  /** The peer's node role, when known (e.g. "drone"). */
  role?: string | null;
  /** WFB channel the peer was heard on. */
  channel?: number | null;
  /** Epoch seconds the peer was last decoded (the relay freshness signal). */
  seenAtUnix?: number | null;
}

export interface CommandCloudStatus {
  deviceId: string;
  version?: string;
  uptimeSeconds?: number;
  boardName?: string;
  boardTier?: number;
  boardSoc?: string;
  boardArch?: string;
  cpuPercent?: number;
  memoryPercent?: number;
  diskPercent?: number;
  temperature?: number | null;
  fcConnected?: boolean;
  fcPort?: string;
  fcBaud?: number;
  /** Gated MAVLink truth, mirrored from the agent's heartbeat / status.
   * `transportOpen` = a port is open; `mavlinkAlive` = a HEARTBEAT decoded
   * within the freshness window; `heartbeatAgeS` = seconds since the last one.
   * Undefined on agents that predate the gated surface. */
  transportOpen?: boolean;
  mavlinkAlive?: boolean;
  /** The agent's own honest connected-or-reachable verdict. True for a healthy
   * MSP FC that never emits the MAVLink HEARTBEAT the alive gate needs, so it
   * is the field to trust over `fcConnected` when the agent supplies it.
   * Undefined on agents that predate it. */
  fcReachable?: boolean;
  heartbeatAgeS?: number | null;
  /** Which FC source the router resolved the link from. */
  fcSource?: "auto" | "serial" | "udp" | "tcp";
  /** Diagnostic hint for a not-alive FC link, mirrored from the agent:
   * `"none"` | `"msp_detected"` (an FC is on the port but speaking MSP, not
   * MAVLink) | `"no_heartbeat"` (a port is open but no HEARTBEAT decoded).
   * Drives the fleet-card FC-link pill. Undefined on agents that predate it. */
  fcLinkHint?: string;
  /** FC protocol family the agent identified on the serial link
   * (`"betaflight"` | `"inav"` for an MSP FC). Mirrored from the agent so the
   * LAN-poll path carries the variant that drives adapter selection. Undefined
   * on ArduPilot / PX4 / an unidentified FC / older agents. */
  fcVariant?: string;
  /** Canonical FC firmware family the agent identified (`"ardupilot"` |
   * `"px4"` | `"betaflight"` | `"inav"` | `"unknown"`). Unlike `fcVariant` it
   * distinguishes the two MAVLink stacks, so the fleet card can name ArduPilot
   * vs PX4. Undefined on older agents. */
  fcFirmware?: string;
  /** Short airframe label (Copter/Plane/VTOL/Tailsitter/Tiltrotor/Rover/Boat/
   * Sub/Heli/Wing/FPV) for the fleet-card + tile flavor badge. */
  frameType?: string;
  memoryUsedMb?: number;
  memoryTotalMb?: number;
  diskUsedGb?: number;
  diskTotalGb?: number;
  cpuCores?: number;
  boardRamMb?: number;
  services?: Array<{ name: string; status: string }>;
  lastIp?: string;
  mdnsHost?: string;
  setupUrl?: string;
  apiUrl?: string;
  missionControlUrl?: string;
  videoState?: string;
  videoWhepPort?: number;
  videoWhepUrl?: string;
  /** Relative or absolute HLS URL for the primary feed, resolved downstream
   * against the agent base. Absent on agents that predate it. */
  videoHlsUrl?: string;
  mavlinkWsPort?: number;
  mavlinkWsUrl?: string;
  remoteAccess?: {
    provider?: string;
    publicUrls?: string[];
  };
  telemetry?: CommandTelemetrySnapshot;
  // WFB radio snapshot (camelCase). Cloud path: the cmd_droneStatus row
  // carries it verbatim. LAN path: copied from /api/status/full. Kept as
  // a loose record so both sources fit without coupling to a strict type;
  // the fleet hook normalizes it before display.
  radio?: Record<string, unknown> | null;
  /** Air-side camera discovery state ("ready" | "missing" | "error").
   * Forwarded from the LAN-direct `/api/status/full` (the cloud path
   * maps cameraState through the capability store). Undefined / null on
   * agents that predate the surface. */
  cameraState?: string | null;
  /** Air-side USB camera recovery state from the LAN-direct status.
   * Undefined on agents that predate the surface. */
  cameraUsbRecovery?: CameraUsbRecovery;
  // ── Cloud-only display pills ────────────────────────────────────
  // These are denormalized onto the heartbeat by the cloud bridge and
  // surfaced as fleet-card badges by the projection selector. They are NOT
  // FC telemetry, so they live here (keyed by deviceId) rather than in the
  // node registry's FC sub-state — a cloud tick that carries them can never
  // overwrite live flight data.
  /** Local panel attached over the 40-pin header ("spi-lcd" | "hdmi" | "none"). */
  attachedDisplayType?: "spi-lcd" | "hdmi" | "none";
  /** How the agent landed on its current profile (drives the "auto" pill). */
  profileSource?: "detected" | "tiebreaker" | "default" | "override" | "user";
  /** Direct LAN MAVLink WebSocket URL the agent advertises (drives "Direct"). */
  manualMavlinkWsUrl?: string;
  /** True when the agent reports an active GPS-denied estimator. */
  navigationGpsDenied?: boolean;
  /** Active vision-nav estimator mode (free-form string). */
  navigationMode?: string;
  /** Inter-rig peer device-id from a decoded WFB PresenceBeacon. */
  peerDeviceId?: string | null;
  /** Peer-reported RSSI in dBm (signed). */
  peerRssiDbm?: number | null;
  /** Every WFB peer this node reports (a ground node can relay more than one
   * drone). Preferred over the scalar `peerDeviceId` when present. Undefined on
   * agents that predate the list; the transitive-enrollment bridge falls back to
   * the scalar peer. */
  linkedPeers?: LinkedPeer[];
  updatedAt: number;
}

interface CommandFleetState {
  cloudStatuses: Record<string, CommandCloudStatus>;
  telemetryByDeviceId: Record<string, CommandTelemetrySnapshot>;
  /** Replace the whole map. Use when one source owns every row in the
   * cloudStatuses table (legacy single-bridge contract). */
  setCloudStatuses: (rows: CommandCloudStatus[]) => void;
  /** Merge rows by deviceId. Use when multiple bridges co-own rows
   * (e.g. the Convex cloud bridge plus the LAN local-node bridge). */
  upsertCloudStatuses: (rows: CommandCloudStatus[]) => void;
  /** Remove rows by deviceId. Use when a node disappears from a
   * bridge's ownership set (unpaired, fleet refresh dropped it). */
  removeCloudStatuses: (deviceIds: string[]) => void;
  setTelemetry: (deviceId: string, telemetry: CommandTelemetrySnapshot) => void;
  clear: () => void;
}

export const useCommandFleetStore = create<CommandFleetState>((set) => ({
  cloudStatuses: {},
  telemetryByDeviceId: {},

  setCloudStatuses(rows) {
    set({
      cloudStatuses: Object.fromEntries(rows.map((row) => [row.deviceId, row])),
    });
  },

  upsertCloudStatuses(rows) {
    if (rows.length === 0) return;
    set((state) => ({
      cloudStatuses: {
        ...state.cloudStatuses,
        ...Object.fromEntries(rows.map((row) => [row.deviceId, row])),
      },
    }));
  },

  removeCloudStatuses(deviceIds) {
    if (deviceIds.length === 0) return;
    set((state) => {
      const next = { ...state.cloudStatuses };
      let changed = false;
      for (const id of deviceIds) {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? { cloudStatuses: next } : state;
    });
  },

  setTelemetry(deviceId, telemetry) {
    set((state) => ({
      telemetryByDeviceId: {
        ...state.telemetryByDeviceId,
        [deviceId]: telemetry,
      },
    }));
  },

  clear() {
    set({ cloudStatuses: {}, telemetryByDeviceId: {} });
  },
}));
