/**
 * @module command/bridges/status-mapper/ground-station
 * @description Builds the per-slice patch the bridge applies to the
 * ground-station store when the agent profile is `ground-station`
 * (link health, pair status, role, uplink, peripherals). Returns null
 * when there's nothing to patch. Pure.
 * @license GPL-3.0-only
 */

import type { GroundStationRole } from "@/lib/api/ground-station/types";
import type { RoleSnapshot } from "@/stores/ground-station/types";

export interface GroundStationFanOutCurrent {
  linkHealth: {
    rssi_dbm: number | null;
    bitrate_mbps: number | null;
    fec_rec: number;
    fec_lost: number;
    channel: number | null;
  };
  status: {
    paired_drone: string | null;
    profile: string;
    uplink_active: string | null;
  };
  role: {
    info: RoleSnapshot | null;
  };
  uplink: {
    active: string | null;
    cloud_relay: {
      mqtt_connected: boolean;
      throttle_state: string;
      forwarding_video: boolean;
      forwarding_telemetry: boolean;
    } | null;
  };
  peripherals: {
    list: unknown[];
  };
}

/**
 * Build the per-slice patch the bridge component should apply to
 * `useGroundStationStore` when the agent profile is `ground-station`.
 * Returns `null` when there's nothing to patch (avoids a no-op
 * setState). Every slice the heartbeat refreshes is stamped with `now`, so
 * the overview cards age it out once heartbeats stop arriving.
 */
export function buildGroundStationPatch(
  cloudStatus: Record<string, unknown>,
  current: GroundStationFanOutCurrent,
  now: number,
): Record<string, unknown> | null {
  const profileField = cloudStatus.profile as string | undefined;
  if (profileField !== "ground-station" && profileField !== "ground_station") {
    return null;
  }

  const radio = cloudStatus.radio as Record<string, unknown> | undefined;
  const roleField = cloudStatus.role as string | undefined;
  const peripherals = cloudStatus.peripherals;
  // Cloud-relay forwarding state posted by the uplink-aware relay bridge when
  // the ground station is reached over the cloud. Present only when the GS is
  // relaying; a locally-reached GS leaves these absent.
  const cloudUplink = cloudStatus.uplink as string | undefined;
  const mqttConnected = cloudStatus.mqttConnected as boolean | undefined;
  const throttleState = cloudStatus.throttleState as string | undefined;
  const forwardingVideo = cloudStatus.forwardingVideo as boolean | undefined;
  const forwardingTelemetry = cloudStatus.forwardingTelemetry as
    | boolean
    | undefined;

  const patch: Record<string, unknown> = {};

  if (radio) {
    const rssiDbm = radio.rssiDbm as number | null | undefined;
    const bitrateKbps = radio.bitrateKbps as number | null | undefined;
    const fecRecovered = radio.fecRecovered as number | null | undefined;
    const fecLost = radio.fecLost as number | null | undefined;
    const channel = radio.channel as number | null | undefined;
    patch.linkHealth = {
      ...current.linkHealth,
      rssi_dbm: rssiDbm ?? null,
      bitrate_mbps: bitrateKbps != null ? bitrateKbps / 1000 : null,
      fec_rec: fecRecovered ?? 0,
      fec_lost: fecLost ?? 0,
      channel: channel ?? null,
    };
    // The link card ages the radio reading on this stamp, so a cloud-reached
    // ground station's fresh heartbeat reads live rather than "Not read".
    patch.linkHealthAt = now;
    const pairedWithDeviceId = radio.pairedWithDeviceId as string | null | undefined;
    patch.status = {
      ...current.status,
      paired_drone: pairedWithDeviceId ?? null,
      profile: "ground_station",
      uplink_active: cloudUplink ?? current.status.uplink_active,
    };
    patch.statusFetchedAt = now;
  }

  if (roleField) {
    const role = roleField as GroundStationRole;
    const currentRoleInfo = current.role.info;
    // The heartbeat carries only the current role. Fields a full role read
    // filled in are kept; fields nothing has read stay unknown.
    const info: RoleSnapshot = {
      current: role,
      configured: currentRoleInfo?.configured ?? null,
      supported: currentRoleInfo?.supported ?? null,
      mesh_capable: currentRoleInfo?.mesh_capable ?? null,
    };
    patch.role = { ...current.role, info, fetchedAt: now };
  }

  // The active uplink the GS reports over the cloud updates the uplink slice,
  // and a relaying GS also carries its live MQTT + throttle + forwarding state.
  // The WFB failover-state label ("local" / "cloud_relay") names the video
  // path, not an uplink interface, so it never stands in for one.
  const cloudRelay =
    throttleState !== undefined ||
    mqttConnected !== undefined ||
    forwardingVideo !== undefined ||
    forwardingTelemetry !== undefined
      ? {
          mqtt_connected: mqttConnected ?? false,
          throttle_state: throttleState ?? "ok",
          forwarding_video: forwardingVideo ?? false,
          forwarding_telemetry: forwardingTelemetry ?? false,
        }
      : current.uplink.cloud_relay;

  if (cloudUplink || cloudRelay !== current.uplink.cloud_relay) {
    patch.uplink = {
      ...current.uplink,
      active: cloudUplink ?? current.uplink.active,
      cloud_relay: cloudRelay,
      fetchedAt: now,
    };
  }

  if (Array.isArray(peripherals)) {
    patch.peripherals = {
      ...current.peripherals,
      list: peripherals as typeof current.peripherals.list,
    };
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
