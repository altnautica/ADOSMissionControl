"use client";

/**
 * @module use-command-agent-fleet
 * @description Merges paired drones, cloud status rows, and live telemetry
 * into the display model used by the Command all-agent overview.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import {
  useCommandFleetStore,
  type CommandCloudStatus,
} from "@/stores/command-fleet-store";
import { useClockTick } from "@/lib/agent/freshness";
import { normalizeRadio } from "@/stores/agent-capabilities/normalizer";
import { linkStateReach } from "@/components/hardware/radio/labels";
import { isFcReachable } from "@/lib/agent/mavlink-link";
import { resolveAgentVideoUrl } from "@/lib/agent/video-url";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import {
  nodeLastSeen,
  nodeLiveness,
  telemetryValue,
  type CommandAgentLiveness,
} from "@/lib/nodes/presence";
import type { RadioState } from "@/lib/api/ground-station/types";

export type { CommandAgentLiveness } from "@/lib/nodes/presence";

export type CommandAgentProfile = "drone" | "ground-station" | "workstation";
export type CommandAgentRole = "direct" | "relay" | "receiver" | null;
export type CommandAgentVideoState =
  | "live"
  | "queued"
  | "paused"
  | "unavailable"
  | "offline";

export interface CommandAgentSummary {
  identity: {
    id: string;
    deviceId: string;
    name: string;
    board?: string;
    tier?: number;
    version?: string;
    lastIp?: string;
  };
  profile: CommandAgentProfile;
  role: CommandAgentRole;
  radio: RadioState | null;
  liveness: CommandAgentLiveness;
  lastSeen: number | null;
  system: {
    cpuPercent: number | null;
    memoryPercent: number | null;
    diskPercent: number | null;
    temperature: number | null;
    fcConnected: boolean;
    serviceCount: number;
    runningServiceCount: number;
  };
  video: {
    state: CommandAgentVideoState;
    agentState: string;
    whepUrl: string | null;
    active: boolean;
    queued: boolean;
  };
  telemetry: {
    armed: boolean | null;
    mode: string | null;
    batteryRemaining: number | null;
    batteryVoltage: number | null;
    gpsSatellites: number | null;
    gpsFixType: number | null;
    altitudeRel: number | null;
    groundspeed: number | null;
  };
}

const videoUrl = resolveAgentVideoUrl;

/**
 * Ground-station device ids whose WFB downlink is already funneled under a live
 * relayed drone node. A ground station has no camera of its own — its video IS
 * the drone's downlink it relays — so once that stream shows under the drone
 * (the funneled feed a relayed node carries), rendering the ground station's own
 * tile too would double the identical feed. Only a relayed drone that currently
 * resolves to a playable feed counts: with the ground link down there is no
 * funneled feed to duplicate (and the ground station's own tile is already gated
 * off by the radio-link check). Pure, so the dedup is unit-testable without the
 * store.
 */
export function groundStationsFunneledUnderDrone(
  nodes: readonly FleetNodeEntry[],
  cloudStatuses: Record<string, CommandCloudStatus | undefined>,
): Set<string> {
  const funneled = new Set<string>();
  for (const n of nodes) {
    if (!n.isRelayed || !n.reachedVia) continue;
    const gsDeviceId = deviceIdFromNodeId(n.reachedVia);
    if (!gsDeviceId) continue;
    if (resolveAgentVideoUrl(cloudStatuses[n.deviceId])) funneled.add(gsDeviceId);
  }
  return funneled;
}

export function useCommandAgentFleet(
  pairedDrones: FleetNodeEntry[],
  activeVideoIds: Set<string>,
  pausedVideoIds: Set<string>,
): CommandAgentSummary[] {
  const cloudStatuses = useCommandFleetStore((s) => s.cloudStatuses);
  const telemetryByDeviceId = useCommandFleetStore((s) => s.telemetryByDeviceId);
  // Liveness, the video-state gate, and canStream all derive from Date.now()
  // against each agent's lastSeen. Without a changing dependency the memo never
  // re-runs, so a dead agent stays "live" with a streaming video tile. The 1Hz
  // shared clock tick forces a re-derivation every second so liveness can
  // transition live -> stale -> offline as time passes.
  const tick = useClockTick();

  return useMemo(() => {
    // Ground nodes whose downlink is already shown under a relayed drone, so
    // their own video tile is suppressed below to keep the feed on screen once.
    const funneledGsIds = groundStationsFunneledUnderDrone(
      pairedDrones,
      cloudStatuses,
    );
    const summaries = pairedDrones.map((drone): CommandAgentSummary => {
      const status = cloudStatuses[drone.deviceId];
      const telemetry = telemetryValue(
        telemetryByDeviceId[drone.deviceId],
        status,
      );
      const lastSeen = nodeLastSeen(drone, status);
      // Shared with the per-node command gates, so an offline row's dark cells
      // and its disabled controls always agree — match droneLiveness.
      const liveness: CommandAgentLiveness = nodeLiveness(drone, status);
      const profile: CommandAgentProfile = drone.profile ?? "drone";
      const radio = status?.radio ? normalizeRadio(status.radio) : null;
      // A ground station has no camera of its own — its video is the downlink
      // it receives over the WFB radio, so it can only be flowing while that
      // link is up. Gate the GS feed on the radio link state so a stale
      // videoState="running" from the agent does not keep a dead feed on
      // screen after the link drops. Only a link classified "up" carries
      // frames: a transmitting-but-unproven link has confirmed no reception,
      // so it has nothing to show, and a missing radio block has no link at
      // all. The radio block reaches the cloud-relay path now that the
      // heartbeat ingest forwards it. A drone streams its own camera over
      // LAN/WebRTC independently of WFB, so it is never gated.
      const radioLinkDown =
        profile === "ground-station" &&
        (radio == null || linkStateReach(radio.state) !== "up");
      // The ground station's only video is the drone downlink it relays. When
      // that same stream is funneled under the drone node, drop the ground
      // station's own tile so the feed shows exactly once (under the drone). The
      // ground station still reports it is relaying — it just loses the
      // duplicate live tile.
      const gsFeedFunneled =
        profile === "ground-station" && funneledGsIds.has(drone.deviceId);
      const whepUrl = radioLinkDown || gsFeedFunneled ? null : videoUrl(status);
      const paused = pausedVideoIds.has(drone.deviceId);
      const active = activeVideoIds.has(drone.deviceId);
      const canStream =
        !radioLinkDown && liveness === "live" && !!whepUrl && !paused;
      const agentVideoState = status?.videoState ?? (whepUrl ? "running" : "unknown");
      const services = status?.services ?? [];

      return {
        identity: {
          id: drone._id,
          deviceId: drone.deviceId,
          name: drone.name,
          board: status?.boardName ?? drone.board,
          tier: status?.boardTier ?? drone.tier,
          version: status?.version ?? drone.agentVersion,
          lastIp: status?.lastIp ?? drone.lastIp,
        },
        profile,
        role: drone.role ?? null,
        radio,
        liveness,
        lastSeen,
        system: {
          cpuPercent: status?.cpuPercent ?? null,
          memoryPercent: status?.memoryPercent ?? null,
          diskPercent: status?.diskPercent ?? null,
          temperature: status?.temperature ?? null,
          // A reachable MSP FC (Betaflight/iNav) never sets fcConnected — it
          // sends no MAVLink heartbeat — but it IS a connected, drivable FC, so
          // fold the MSP variant/transport signal in rather than reading "no FC".
          fcConnected: isFcReachable({
            fcConnected: status?.fcConnected ?? drone.fcConnected,
            fcVariant: status?.fcVariant,
            transportOpen: status?.transportOpen,
          }),
          serviceCount: services.length,
          runningServiceCount: services.filter((s) => s.status === "running").length,
        },
        video: {
          state:
            liveness === "offline"
              ? "offline"
              : paused
                ? "paused"
                : canStream
                  ? active
                    ? "live"
                    : "queued"
                  : "unavailable",
          agentState: agentVideoState,
          whepUrl,
          active,
          queued: canStream && !active,
        },
        telemetry: {
          armed: typeof telemetry?.armed === "boolean" ? telemetry.armed : null,
          mode: telemetry?.mode ?? null,
          batteryRemaining:
            typeof telemetry?.battery?.remaining === "number"
              ? telemetry.battery.remaining
              : null,
          batteryVoltage:
            typeof telemetry?.battery?.voltage === "number"
              ? telemetry.battery.voltage
              : null,
          gpsSatellites:
            typeof telemetry?.gps?.satellites === "number"
              ? telemetry.gps.satellites
              : null,
          gpsFixType:
            typeof telemetry?.gps?.fix_type === "number"
              ? telemetry.gps.fix_type
              : null,
          altitudeRel:
            typeof telemetry?.position?.alt_rel === "number"
              ? telemetry.position.alt_rel
              : null,
          groundspeed:
            typeof telemetry?.velocity?.groundspeed === "number"
              ? telemetry.velocity.groundspeed
              : null,
        },
      };
    });

    return summaries.sort((a, b) => {
      const liveRank = { live: 0, stale: 1, offline: 2 };
      const videoRank = { live: 0, queued: 1, paused: 2, unavailable: 3, offline: 4 };
      return (
        liveRank[a.liveness] - liveRank[b.liveness] ||
        videoRank[a.video.state] - videoRank[b.video.state] ||
        a.identity.name.localeCompare(b.identity.name)
      );
    });
  }, [activeVideoIds, cloudStatuses, pairedDrones, pausedVideoIds, telemetryByDeviceId, tick]);
}

export function formatCommandAge(ts: number | null): string {
  if (!ts) return "never";
  const elapsed = Math.max(0, Date.now() - ts);
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
