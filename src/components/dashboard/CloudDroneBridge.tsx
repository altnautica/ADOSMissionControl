"use client";

/**
 * @module CloudDroneBridge
 * @description Feeds cloud-paired ADOS agents into the canonical node registry
 * as `"cloud"` presence (identity, profile, role, posture). The cloud-only
 * display pills (Direct / nav / peer / camera / profile-source / …) are
 * pushed into `command-fleet-store` keyed by deviceId; the FleetProjectionBridge
 * merges them back onto the projected row. Staleness drops the cloud presence
 * source (and the pills) so an offline cloud node collapses to whatever the LAN
 * presence still anchors — never a duplicate row.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { cmdDronesApi } from "@/lib/community-api-drones";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useClockTick } from "@/lib/agent/freshness";
import { livenessFromTimestamp } from "@/lib/nodes/presence";
import { normalizeCameraUsbRecovery } from "@/lib/agent/camera-recovery";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import type {
  CommandCloudStatus,
  LinkedPeer,
} from "@/stores/command-fleet-store";
import {
  useNodeRegistryStore,
  resolveNodeId,
} from "@/stores/node-registry";
import type { NodeProfile, NodeRole } from "@/stores/node-registry";

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function pickBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function pickNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Parse the additive `linkedPeers` list off a cloud drone row (a ground node
 * can relay more than one drone). Absent / malformed on agents that predate it,
 * in which case the transitive-enrollment bridge falls back to the scalar peer. */
function pickLinkedPeers(value: unknown): LinkedPeer[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const peers = value
    .map((raw): LinkedPeer | null => {
      const p = raw as { deviceId?: unknown; rssiDbm?: unknown; role?: unknown; channel?: unknown; seenAtUnix?: unknown };
      const deviceId = pickString(p.deviceId);
      if (!deviceId) return null;
      return {
        deviceId,
        rssiDbm: pickNumberOrNull(p.rssiDbm),
        role: pickString(p.role) ?? null,
        channel: pickNumberOrNull(p.channel),
        seenAtUnix: pickNumberOrNull(p.seenAtUnix),
      };
    })
    .filter((p): p is LinkedPeer => p !== null);
  return peers.length > 0 ? peers : undefined;
}

/** The status-row fields this bridge writes. On a stale or unpaired node only
 * these are stripped: the LAN bridge may co-own the same row, and its fields
 * must survive the cloud going quiet. */
const CLOUD_OWNED_FIELDS = [
  "attachedDisplayType",
  "profileSource",
  "manualMavlinkWsUrl",
  "navigationGpsDenied",
  "navigationMode",
  "peerDeviceId",
  "peerRssiDbm",
  "linkedPeers",
  "transportOpen",
  "mavlinkAlive",
  "heartbeatAgeS",
  "fcSource",
  "fcLinkHint",
  "fcFirmware",
  "cameraState",
  "cameraUsbRecovery",
] as const satisfies readonly (keyof CommandCloudStatus)[];

/** Withdraw this bridge's claim on one node: its cloud presence source and its
 * cloud-owned status fields. A row left with nothing but its id and timestamp
 * is removed; one the LAN bridge still feeds keeps the LAN fields. */
function dropCloudNode(deviceId: string): void {
  useNodeRegistryStore.getState().dropPresence(resolveNodeId(deviceId), "cloud");
  const fleetStatus = useCommandFleetStore.getState();
  const row = fleetStatus.cloudStatuses[deviceId];
  if (!row) return;
  const stripped: CommandCloudStatus = { ...row };
  for (const key of CLOUD_OWNED_FIELDS) delete stripped[key];
  const remaining = Object.keys(stripped).filter(
    (k) => k !== "deviceId" && k !== "updatedAt",
  );
  if (remaining.length === 0) fleetStatus.removeCloudStatuses([deviceId]);
  else fleetStatus.upsertCloudStatuses([stripped]);
}

export function CloudDroneBridge() {
  // deviceIds this bridge currently owns cloud presence + pills for.
  const trackedDeviceIds = useRef<Set<string>>(new Set());
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const myDrones = useConvexSkipQuery(cmdDronesApi.listMyDrones, {
    enabled: isAuthenticated,
  });
  // A Convex query only re-emits on a write, so a node that stops reporting
  // would never be re-judged. Staleness is re-checked on the shared 1 Hz clock.
  const tick = useClockTick();

  useEffect(() => {
    // Signed out, query error, or query disabled: nothing vouches for any
    // cloud node any more.
    if (!Array.isArray(myDrones)) {
      for (const deviceId of trackedDeviceIds.current) dropCloudNode(deviceId);
      trackedDeviceIds.current.clear();
      return;
    }
    const now = Date.now();
    for (const drone of myDrones) {
      if (!trackedDeviceIds.current.has(drone.deviceId)) continue;
      if (livenessFromTimestamp(drone.lastSeen ?? null, now) === "live") continue;
      dropCloudNode(drone.deviceId);
      trackedDeviceIds.current.delete(drone.deviceId);
    }
  }, [myDrones, tick]);

  useEffect(() => {
    if (!Array.isArray(myDrones)) return;

    const registry = useNodeRegistryStore.getState();
    const fleetStatus = useCommandFleetStore.getState();
    const now = Date.now();
    const current = new Set<string>();
    const pillRows: CommandCloudStatus[] = [];

    for (const drone of myDrones) {
      const deviceId = drone.deviceId;
      const lastSeen = drone.lastSeen ?? 0;
      const isOnline = livenessFromTimestamp(lastSeen, now) === "live";
      const nodeId = resolveNodeId(deviceId);

      // A stale node is withdrawn by the staleness effect above (which runs
      // first on the same emission); it is simply not re-published here.
      if (!isOnline) continue;

      current.add(deviceId);

      const profileRaw = (drone as { profile?: unknown }).profile;
      const profile: NodeProfile =
        profileRaw === "ground-station" || profileRaw === "workstation"
          ? profileRaw
          : "drone";
      const roleRaw = (drone as { role?: unknown }).role;
      const role: NodeRole =
        roleRaw === "direct" || roleRaw === "relay" || roleRaw === "receiver"
          ? roleRaw
          : null;
      const cloudPostureRaw = (drone as { cloudPosture?: unknown }).cloudPosture;
      const cloudPosture =
        cloudPostureRaw === "local" ||
        cloudPostureRaw === "cloud" ||
        cloudPostureRaw === "self_hosted"
          ? cloudPostureRaw
          : undefined;

      // Cloud is authoritative for identity. Feed presence to the registry.
      registry.upsertPresence(
        nodeId,
        {
          deviceId,
          name: drone.name || `Agent ${deviceId.slice(0, 8)}`,
          profile,
          role,
          cloudPosture,
          cloudDeviceId: deviceId,
          agentIdentityKnown: true,
          lastHeartbeat: lastSeen,
        },
        "cloud",
      );
      trackedDeviceIds.current.add(deviceId);

      // ── Cloud-only display pills → command-fleet-store ──────────────
      const attachedDisplayTypeRaw = (drone as { attachedDisplayType?: unknown })
        .attachedDisplayType;
      const attachedDisplayType: CommandCloudStatus["attachedDisplayType"] =
        attachedDisplayTypeRaw === "spi-lcd" ||
        attachedDisplayTypeRaw === "hdmi" ||
        attachedDisplayTypeRaw === "none"
          ? attachedDisplayTypeRaw
          : undefined;
      const profileSourceRaw = (drone as { profileSource?: unknown })
        .profileSource;
      const profileSource: CommandCloudStatus["profileSource"] =
        profileSourceRaw === "detected" ||
        profileSourceRaw === "tiebreaker" ||
        profileSourceRaw === "default" ||
        profileSourceRaw === "override" ||
        profileSourceRaw === "user"
          ? profileSourceRaw
          : undefined;
      const cameraStateRaw = (drone as { cameraState?: unknown }).cameraState;
      const cameraState =
        cameraStateRaw === "ready" ||
        cameraStateRaw === "missing" ||
        cameraStateRaw === "error"
          ? cameraStateRaw
          : null;
      const peerDeviceId = pickString(
        (drone as { peerDeviceId?: unknown }).peerDeviceId,
      );
      const peerRssiRaw = (drone as { peerRssiDbm?: unknown }).peerRssiDbm;
      const peerRssiDbm =
        typeof peerRssiRaw === "number" && Number.isFinite(peerRssiRaw)
          ? peerRssiRaw
          : null;
      // Gated MAVLink truth carried on the cloud heartbeat (when the agent
      // ships it). Forward so a cloud-relayed drone reads the same honest FC
      // state the LAN-direct path does.
      const heartbeatAgeRaw = (drone as { heartbeatAgeS?: unknown }).heartbeatAgeS;
      const fcSourceRaw = (drone as { fcSource?: unknown }).fcSource;
      const fcSource: CommandCloudStatus["fcSource"] =
        fcSourceRaw === "auto" ||
        fcSourceRaw === "serial" ||
        fcSourceRaw === "udp" ||
        fcSourceRaw === "tcp"
          ? fcSourceRaw
          : undefined;

      // Merge onto any existing status row (the LAN bridge may co-own it) so
      // pills + LAN telemetry coexist. updatedAt anchors cloud freshness.
      const existing = fleetStatus.cloudStatuses[deviceId];
      pillRows.push({
        ...(existing ?? { deviceId }),
        deviceId,
        attachedDisplayType,
        profileSource,
        manualMavlinkWsUrl: pickString(
          (drone as { manualMavlinkWsUrl?: unknown }).manualMavlinkWsUrl,
        ),
        navigationGpsDenied: pickBoolean(
          (drone as { navigationGpsDenied?: unknown }).navigationGpsDenied,
        ),
        navigationMode: pickString(
          (drone as { navigationMode?: unknown }).navigationMode,
        ),
        peerDeviceId,
        peerRssiDbm,
        linkedPeers: pickLinkedPeers(
          (drone as { linkedPeers?: unknown }).linkedPeers,
        ),
        transportOpen: pickBoolean(
          (drone as { transportOpen?: unknown }).transportOpen,
        ),
        mavlinkAlive: pickBoolean(
          (drone as { mavlinkAlive?: unknown }).mavlinkAlive,
        ),
        heartbeatAgeS:
          typeof heartbeatAgeRaw === "number" &&
          Number.isFinite(heartbeatAgeRaw)
            ? heartbeatAgeRaw
            : heartbeatAgeRaw === null
              ? null
              : undefined,
        fcSource,
        fcLinkHint: pickString((drone as { fcLinkHint?: unknown }).fcLinkHint),
        fcFirmware: pickString((drone as { fcFirmware?: unknown }).fcFirmware),
        cameraState,
        cameraUsbRecovery: normalizeCameraUsbRecovery(
          (drone as { cameraUsbRecovery?: unknown }).cameraUsbRecovery,
        ),
        updatedAt: lastSeen > 0 ? lastSeen : now,
      });
    }

    if (pillRows.length > 0) fleetStatus.upsertCloudStatuses(pillRows);

    // Drop cloud presence + pills for drones no longer in the paired list.
    for (const deviceId of Array.from(trackedDeviceIds.current)) {
      if (!current.has(deviceId)) {
        dropCloudNode(deviceId);
        trackedDeviceIds.current.delete(deviceId);
      }
    }
  }, [myDrones]);

  useEffect(() => {
    const tracked = trackedDeviceIds.current;
    return () => {
      for (const deviceId of tracked) dropCloudNode(deviceId);
      tracked.clear();
    };
  }, []);

  return null;
}
