/**
 * @module mock/demo-seed/agent-system
 * @description Seeds the focused demo node's agent-system status, services, resources,
 * logs and capabilities.
 * @license GPL-3.0-only
 */

import { AGENT_VERSION, DEMO_AGENTS } from "./fleet";
import { useDroneManager } from "@/stores/drone-manager";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import type { PairedDrone } from "@/stores/pairing-store";
import { deviceIdFromNodeId } from "@/lib/agent/node-id";
import type { AgentStatus, ServiceInfo, SystemResources, LogEntry } from "@/lib/agent/types";
import { DEMO_WORKSTATION } from "@/mock/drones";
import { setMockAgentOverride } from "@/mock/agent/client";
import { setMockConfigProfile } from "@/mock/agent/config";
import { getMockCapabilities, getMockGroundStationCapabilities, type MockPerceptionOverride } from "@/mock/agent/capabilities";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

/** A small +/- wobble so seeded metrics read as live rather than pinned. */
function demoJitter(base: number, amp: number): number {
  return base + (Math.random() - 0.5) * 2 * amp;
}

/** A profile-appropriate board descriptor for the seeded agent status. */
function demoBoard(agent: PairedDrone): AgentStatus["board"] {
  if (agent.profile === "workstation") {
    return {
      name: agent.name,
      model: "Apple Silicon",
      tier: 3,
      ram_mb: 65_536,
      cpu_cores: 12,
      vendor: "Apple",
      soc: "workstation",
      arch: "arm64",
      hw_video_codecs: ["h264", "hevc"],
    };
  }
  if (agent.profile === "ground-station") {
    return {
      name: agent.name,
      model: "Ground Node",
      tier: agent.tier ?? 3,
      ram_mb: 4096,
      cpu_cores: 4,
      vendor: "Reference",
      soc: "ground-node",
      arch: "aarch64",
      hw_video_codecs: ["h264_v4l2m2m"],
    };
  }
  return {
    name: agent.name,
    model: "Reference Companion",
    tier: agent.tier ?? 3,
    ram_mb: 4096,
    cpu_cores: 4,
    vendor: "Reference",
    soc: "companion",
    arch: "aarch64",
    hw_video_codecs: ["h264_v4l2m2m"],
  };
}

function demoServices(agent: PairedDrone): ServiceInfo[] {
  const names: [string, ServiceInfo["status"]][] =
    agent.profile === "workstation"
      ? [
          ["ados-control", "running"],
          ["ados-compute", "running"],
        ]
      : agent.profile === "ground-station"
        ? [
            ["ados-control", "running"],
            ["ados-wfb-receiver", "running"],
            ["mediamtx-gs", "running"],
          ]
        : [
            ["ados-control", "running"],
            ["ados-mavlink", "running"],
            ["ados-video", "stopped"],
          ];
  return names.map(([name, status], i) => ({
    name,
    status,
    pid: 1000 + i,
    cpu_percent: demoJitter(6, 3),
    memory_mb: demoJitter(60, 20),
    uptime_seconds: 7_200,
    category: "core",
  }));
}

function demoResources(): SystemResources {
  const totalMb = 4096;
  const usedMb = demoJitter(1500, 120);
  return {
    cpu_percent: demoJitter(30, 8),
    memory_percent: demoJitter(38, 4),
    memory_used_mb: usedMb,
    memory_total_mb: totalMb,
    memory_available_mb: Math.max(0, totalMb - usedMb),
    memory_cache_mb: demoJitter(800, 60),
    swap_total_mb: 2048,
    swap_used_mb: demoJitter(160, 30),
    swap_percent: demoJitter(8, 2),
    disk_percent: demoJitter(40, 2),
    disk_used_gb: demoJitter(13, 0.5),
    disk_total_gb: 32,
    temperature: demoJitter(46, 3),
  };
}

function demoLogs(agent: PairedDrone, now: number): LogEntry[] {
  const svc =
    agent.profile === "workstation"
      ? "ados-compute"
      : agent.profile === "ground-station"
        ? "ados-wfb-receiver"
        : "ados-mavlink";
  const line =
    agent.profile === "workstation"
      ? "reconstruct job-recon-04 at 62% (30000 steps)"
      : agent.profile === "ground-station"
        ? "RX link locked -58 dBm ch149, relay mesh 2 peers"
        : "MAVLink heartbeat healthy, 3D fix 16 sats";
  return [
    {
      timestamp: new Date(now - 30_000).toISOString(),
      level: "info",
      service: "ados-control",
      message: "agent heartbeat ok",
    },
    {
      timestamp: new Date(now - 15_000).toISOString(),
      level: "info",
      service: svc,
      message: line,
    },
    {
      timestamp: new Date(now - 4_000).toISOString(),
      level: "debug",
      service: svc,
      message: "status poll ok",
    },
  ];
}

function demoAgentStatus(agent: PairedDrone, now: number): AgentStatus {
  const isDrone = (agent.profile ?? "drone") === "drone";
  return {
    version: agent.agentVersion ?? AGENT_VERSION,
    uptime_seconds: 7_200,
    board: demoBoard(agent),
    health: {
      cpu_percent: demoJitter(30, 8),
      memory_percent: demoJitter(38, 4),
      disk_percent: demoJitter(40, 2),
      temperature: demoJitter(46, 3),
      timestamp: new Date(now).toISOString(),
    },
    fc_connected: isDrone,
    fc_port: isDrone ? "/dev/ttyACM0" : "",
    fc_baud: isDrone ? 115_200 : 0,
    transport_open: isDrone,
    mavlink_alive: isDrone,
    heartbeat_age_s: isDrone ? demoJitter(0.8, 0.3) : null,
    fc_source: "serial",
    kernel_release: "6.1.0",
    wfb_module_source: "prebuilt",
    install_status: "ok",
    install_version: agent.agentVersion,
    failed_steps: [],
  };
}

/**
 * Seed the singleton agent-system store with the CURRENTLY FOCUSED node's
 * profile-appropriate status / resources / services / logs, so its Overview,
 * Health, and Logs tabs render that node's own data. The mock agent poll only
 * ever reflects one node, so without this the workstation / ground-station
 * overviews (which gate on `status`) sit on "Waiting for agent status".
 */
export function seedFocusedAgentSystem(now: number): void {
  const selId = useDroneManager.getState().selectedDroneId;
  const devId = selId ? (deviceIdFromNodeId(selId) ?? selId) : null;
  const agent = DEMO_AGENTS.find((a) => a.deviceId === devId) ?? DEMO_AGENTS[0];
  // Point the mock node-config surface at the focused node's profile so the
  // Settings tab's identity page reads the right profile (drone / ground-station
  // / workstation).
  setMockConfigProfile(agent.profile ?? "drone");
  const status = demoAgentStatus(agent, now);
  const resources = demoResources();
  const services = demoServices(agent);
  useAgentSystemStore.setState({
    status,
    resources,
    services,
    logs: demoLogs(agent, now),
    processCpuPercent: demoJitter(4, 2),
    processMemoryMb: demoJitter(60, 12),
    lastUpdatedAt: now,
    stale: false,
  });
  // Publish the SAME profile-correct data to the mock agent client so its poll
  // (which also writes the singleton agent-system store) returns this node's
  // data instead of the drone-flavored "CM4 · FC connected" default — otherwise
  // the poll and this seed race and the workstation / GS flicker a false status.
  setMockAgentOverride({ status, services, resources });
}

/**
 * One demo drone runs its detector by OFFLOADING to the workstation (no onboard
 * NPU); the rest run LOCAL on their own NPU. Returns the perception override for
 * a companion drone, or null for a node that runs no perception (the FC-only
 * baseline, the workstation, the ground station) so we don't seed drone caps
 * over it.
 */
const OFFLOAD_DEMO_DRONE = "charlie-3";

function demoPerceptionFor(agent: PairedDrone): MockPerceptionOverride | null {
  // A companion drone has an onboard computer (board set); an FC-only drone or a
  // non-drone node has no perception surface to describe.
  if ((agent.profile ?? "drone") !== "drone" || !agent.board) return null;
  if (agent.deviceId === OFFLOAD_DEMO_DRONE) {
    return {
      perceptionTier: "offload",
      perceptionOffloadTarget: `${DEMO_WORKSTATION.deviceId}.local:8092`,
      npuTops: 0,
      hasAccelerator: false,
      npuAvailable: false,
    };
  }
  return { perceptionTier: "local", perceptionOffloadTarget: null };
}

/**
 * Seed the singleton per-node capabilities store with the FOCUSED companion
 * drone's caps, tagged with its perception tier, so the Perception tier card +
 * the cockpit perception-health chip render a plausible LOCAL / OFFLOAD tier per
 * drone. Runs on selection (the poll never reloads caps in demo, and `selectDrone`
 * clears them on switch), not on the 2 s tick, so it never reverts live UI state.
 */
export function seedFocusedCapabilities(): void {
  const selId = useDroneManager.getState().selectedDroneId;
  const devId = selId ? (deviceIdFromNodeId(selId) ?? selId) : null;
  const agent = devId ? DEMO_AGENTS.find((a) => a.deviceId === devId) : undefined;
  if (!agent) return;
  // The ground station advertises its WFB radio + CRSF/ELRS control lane, so its
  // capability store gates the Radio + RC/ELRS Link tabs on (radioPresent /
  // crsfPresent). Leaner than a drone's caps (no NPU / vision).
  if (agent.profile === "ground-station") {
    useAgentCapabilitiesStore
      .getState()
      .setCapabilities(getMockGroundStationCapabilities(), devId);
    return;
  }
  const perception = demoPerceptionFor(agent);
  if (!perception) return;
  useAgentCapabilitiesStore
    .getState()
    .setCapabilities(getMockCapabilities("optical_flow", perception), devId);
}
