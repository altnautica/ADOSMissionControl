/**
 * @module agent/full-status-to-cloud-status
 * @description Pure mapping from the agent's consolidated
 * `/api/status/full` response into the GCS-side `CommandCloudStatus`
 * row that the Agent Overview tiles consume. Used by the LAN local-node
 * polling bridge so LAN-only paired nodes show real telemetry in the
 * overview grid (the cloud bridge writes the same shape from Convex).
 * @license GPL-3.0-only
 */

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type {
  CommandCloudStatus,
  CommandTelemetrySnapshot,
  LinkedPeer,
} from "@/stores/command-fleet-store";
import type { CameraUsbRecovery, FullStatusResponse } from "./types";
import { normalizeCameraUsbRecovery } from "./camera-recovery";

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseWhepPort(url: string | null | undefined): number | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    const port = Number(parsed.port);
    return Number.isFinite(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}

function mapTelemetry(raw: Record<string, unknown>): CommandTelemetrySnapshot {
  const lat = numberOrUndefined(raw.lat);
  const lon = numberOrUndefined(raw.lon);
  const alt = numberOrUndefined(raw.alt);
  const altRel = numberOrUndefined(raw.relative_alt);
  const heading = numberOrUndefined(raw.heading);
  const groundspeed = numberOrUndefined(raw.groundspeed);
  const airspeed = numberOrUndefined(raw.airspeed);
  const climb = numberOrUndefined(raw.climb);
  const batteryVoltage = numberOrUndefined(raw.battery_voltage);
  const batteryCurrent = numberOrUndefined(raw.battery_current);
  const batteryRemaining = numberOrUndefined(raw.battery_remaining);
  const gpsFix = numberOrUndefined(raw.gps_fix);
  const satellites = numberOrUndefined(raw.satellites);

  const snapshot: CommandTelemetrySnapshot = {
    armed: booleanOrUndefined(raw.armed),
    mode: stringOrUndefined(raw.mode),
  };

  if (
    lat !== undefined ||
    lon !== undefined ||
    alt !== undefined ||
    altRel !== undefined ||
    heading !== undefined
  ) {
    snapshot.position = {
      lat,
      lon,
      alt_msl: alt,
      alt_rel: altRel,
      heading,
    };
  }

  if (groundspeed !== undefined || airspeed !== undefined || climb !== undefined) {
    snapshot.velocity = { groundspeed, airspeed, climb };
  }

  if (
    batteryVoltage !== undefined ||
    batteryCurrent !== undefined ||
    batteryRemaining !== undefined
  ) {
    snapshot.battery = {
      voltage: batteryVoltage,
      current: batteryCurrent,
      remaining: batteryRemaining,
    };
  }

  if (gpsFix !== undefined || satellites !== undefined) {
    snapshot.gps = { fix_type: gpsFix, satellites };
  }

  return snapshot;
}

/** Pure mapper. Safe to call in tests without any store or network state. */
export function mapFullStatusToCloudStatus(
  resp: FullStatusResponse,
  node: Pick<
    FleetNodeEntry,
    "deviceId" | "mdnsHost" | "lastIp" | "name"
  > & { hostname?: string },
): CommandCloudStatus {
  const services = Array.isArray(resp.services)
    ? resp.services.map((svc) => ({
        name: svc.name,
        status: svc.state,
      }))
    : [];

  const videoWhepUrl = resp.video?.whep_url ?? undefined;

  // WFB peers, so local-first transitive enrollment works over the LAN without
  // the cloud relay. Prefer the list; fall back to the scalar peer.
  const linkedPeers: LinkedPeer[] | undefined = Array.isArray(resp.linked_peers)
    ? resp.linked_peers
        .filter((p) => typeof p?.device_id === "string" && p.device_id.length > 0)
        .map((p) => ({
          deviceId: p.device_id as string,
          rssiDbm: numberOrUndefined(p.rssi_dbm) ?? null,
          role: stringOrUndefined(p.role) ?? null,
          channel: numberOrUndefined(p.channel) ?? null,
          seenAtUnix: numberOrUndefined(p.seen_at_unix) ?? null,
        }))
    : undefined;

  // Air-side camera state. Clamp the discovery state to the known set so
  // a future / malformed value never pins a bad badge, and parse the
  // recovery block through the shared forward-permissive parser.
  const cameraStateRaw = resp.cameraState;
  const cameraState =
    cameraStateRaw === "ready" ||
    cameraStateRaw === "missing" ||
    cameraStateRaw === "error"
      ? cameraStateRaw
      : undefined;
  const cameraUsbRecovery: CameraUsbRecovery | undefined =
    normalizeCameraUsbRecovery(resp.cameraUsbRecovery);

  return {
    deviceId: node.deviceId,
    version: resp.version,
    uptimeSeconds: resp.uptime_seconds,
    boardName: resp.board?.name,
    boardTier: resp.board?.tier,
    boardSoc: resp.board?.soc,
    boardArch: resp.board?.arch,
    cpuCores: resp.board?.cpu_cores,
    boardRamMb: resp.board?.ram_mb,
    fcConnected: resp.fc_connected,
    fcPort: resp.fc_port,
    fcBaud: resp.fc_baud,
    transportOpen: booleanOrUndefined(resp.transport_open),
    mavlinkAlive: booleanOrUndefined(resp.mavlink_alive),
    heartbeatAgeS:
      resp.heartbeat_age_s === null
        ? null
        : numberOrUndefined(resp.heartbeat_age_s),
    fcSource:
      resp.fc_source === "auto" ||
      resp.fc_source === "serial" ||
      resp.fc_source === "udp" ||
      resp.fc_source === "tcp"
        ? resp.fc_source
        : undefined,
    fcLinkHint: stringOrUndefined(resp.fc_link_hint),
    fcVariant: stringOrUndefined(resp.fc_variant),
    fcFirmware: stringOrUndefined(resp.fc_firmware),
    cpuPercent: resp.resources?.cpu_percent,
    memoryPercent: resp.resources?.memory_percent,
    diskPercent: resp.resources?.disk_percent,
    temperature: resp.resources?.temperature ?? null,
    services,
    lastIp: node.lastIp,
    mdnsHost: node.mdnsHost,
    apiUrl: node.hostname ? `${node.hostname}/api` : undefined,
    videoState: resp.video?.state,
    videoWhepUrl: videoWhepUrl ?? undefined,
    videoWhepPort: parseWhepPort(videoWhepUrl),
    telemetry: mapTelemetry(resp.telemetry ?? {}),
    radio: resp.radio ?? undefined,
    peerDeviceId: stringOrUndefined(resp.peerDeviceId) ?? null,
    peerRssiDbm: numberOrUndefined(resp.peerRssiDbm) ?? null,
    linkedPeers,
    cameraState,
    cameraUsbRecovery,
    updatedAt: Date.now(),
  };
}
