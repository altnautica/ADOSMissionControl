"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { DemoMissionSync } from "@/components/layout/DemoMissionSync";
import { isDemoPlanId, DEMO_MISSION_FOLDER_ID } from "@/mock/demo-missions";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { usePairingStore, type PairedDrone } from "@/stores/pairing-store";
import {
  clearDemoNodeCommands,
  demoTelemetryOverride,
} from "@/mock/demo-node-commands";
import { useCommandFleetStore, type CommandCloudStatus } from "@/stores/command-fleet-store";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useComputeStore } from "@/stores/compute-store";
import { useGroundStationStore } from "@/stores/ground-station-store";
import { nodeIdForDevice, deviceIdFromNodeId } from "@/lib/agent/node-id";
import type {
  AgentStatus,
  ServiceInfo,
  SystemResources,
  LogEntry,
} from "@/lib/agent/types";
import { DEMO_DRONES, DEMO_WORKSTATION, DEMO_GROUND_STATION, firmwareMeta } from "@/mock/drones";
import { setMockAgentOverride } from "@/mock/agent/client";
import {
  getMockCapabilities,
  type MockPerceptionOverride,
} from "@/mock/agent/capabilities";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

const AGENT_VERSION = "0.99.80";

/**
 * The demo paired-agent set that feeds the sidebar + Command agent-overview
 * grid: every flight-controller drone in DEMO_DRONES plus the workstation and
 * ground-station nodes. Its deviceIds are the SAME base ids the mock engine
 * seeds into the node registry, so `nodeIdForDevice(deviceId)` collapses to the
 * registry node and opening a grid tile lands on the matching profile-aware
 * detail panel. Companion drones (`hasAgent`) carry a companion board/tier/os;
 * the single FC-only drone omits them so its grid tile + node console render the
 * FC-only surfaces (no fabricated companion metrics).
 */
const DEMO_DRONE_AGENTS: PairedDrone[] = DEMO_DRONES.map((d, i) => ({
  _id: `demo-${d.id}`,
  userId: "demo",
  deviceId: d.id,
  name: d.name,
  apiKey: "demo",
  agentVersion: AGENT_VERSION,
  ...(d.hasAgent ? { board: "Reference Companion", tier: 3, os: "Linux" } : {}),
  lastIp: "127.0.0.1",
  lastSeen: Date.now(),
  fcConnected: true,
  pairedAt: Date.now() - 86_400_000 + i * 60_000,
  profile: "drone" as const,
}));

const DEMO_AGENTS: PairedDrone[] = [
  ...DEMO_DRONE_AGENTS,
  {
    _id: "demo-forge-1",
    userId: "demo",
    deviceId: DEMO_WORKSTATION.deviceId,
    name: DEMO_WORKSTATION.name,
    apiKey: "demo",
    agentVersion: AGENT_VERSION,
    board: DEMO_WORKSTATION.board,
    os: "macOS",
    lastIp: "127.0.0.1",
    lastSeen: Date.now(),
    fcConnected: false,
    pairedAt: Date.now() - 60_000_000,
    profile: "workstation",
  },
  {
    _id: "demo-groundstation-1",
    userId: "demo",
    deviceId: DEMO_GROUND_STATION.deviceId,
    name: DEMO_GROUND_STATION.name,
    apiKey: "demo",
    agentVersion: AGENT_VERSION,
    board: DEMO_GROUND_STATION.board,
    tier: 3,
    os: "Linux",
    lastIp: "127.0.0.1",
    lastSeen: Date.now(),
    fcConnected: false,
    pairedAt: Date.now() - 48_000_000,
    profile: "ground-station",
    role: "relay",
  },
];

/**
 * Two demo drones the operator has paired over the LAN (Add-a-Node card),
 * so the Nodes board shows the local-first `lan` reach kind (Rule 39) — not
 * just cloud-relay. They shadow their cloud-paired rows (same deviceId), so the
 * LAN transport wins over cloud for those two. Generic private hostnames (no
 * real lab host). Their `deviceId`s are the removal keys the demo teardown +
 * residue sweep use, so a real fleet's LAN nodes are never touched. */
const DEMO_LAN_NODES: Array<Omit<LocalNode, "pairedAt" | "lastSeenAt">> = [
  {
    deviceId: "foxtrot-6",
    name: "Foxtrot-06",
    hostname: "http://192.168.1.50:8080",
    apiKey: "demo",
    profile: "drone",
    board: "Reference Companion",
    version: AGENT_VERSION,
    mdnsHost: "foxtrot-06.local",
    ipv4: "192.168.1.50",
  },
  {
    deviceId: "mike-13",
    name: "Mike-13",
    hostname: "http://192.168.1.51:8080",
    apiKey: "demo",
    profile: "drone",
    board: "Reference Companion",
    version: AGENT_VERSION,
    mdnsHost: "mike-13.local",
    ipv4: "192.168.1.51",
  },
];

/** Seed the browser-local LAN-node registry with the demo LAN drones so they
 * resolve `lan` reach. Idempotent (addNode merges by deviceId). */
function seedDemoLanNodes(now: number): void {
  const store = useLocalNodesStore.getState();
  for (const node of DEMO_LAN_NODES) {
    store.addNode({ ...node, pairedAt: now, lastSeenAt: now });
  }
}

/** Remove ONLY the demo LAN nodes by their fixed deviceIds — never the whole
 * store, so a real fleet's LAN-paired nodes survive toggling demo off. */
function clearDemoLanNodes(): void {
  const store = useLocalNodesStore.getState();
  for (const node of DEMO_LAN_NODES) store.removeNode(node.deviceId);
}

/** Per-drone flight telemetry for the Command grid tiles (the map itself is fed
 * by the live mock engine through the node registry). Derived from DEMO_DRONES so
 * the roster stays in sync; ground vehicles read ~0 altitude and the sub a
 * negative depth (Rule 44 — an honest per-airframe reading). */
const DRONE_TELEMETRY: Record<
  string,
  NonNullable<CommandCloudStatus["telemetry"]>
> = Object.fromEntries(
  DEMO_DRONES.map((d) => {
    const isGround = d.firmware === "ardupilot-rover" || d.firmware === "ardupilot-boat";
    const isSub = d.firmware === "ardupilot-sub";
    const altRel = isSub ? -5 : isGround ? 0 : 40 + (d.pathIndex % 3) * 12;
    const speed = isSub ? 1.5 : isGround ? 2.5 : 6 + (d.pathIndex % 4);
    return [
      d.id,
      {
        armed: true,
        mode: d.flightMode,
        position: {
          lat: d.homeLat,
          lon: d.homeLon,
          alt_rel: altRel,
          heading: (d.pathIndex * 47) % 360,
        },
        velocity: { groundspeed: speed },
        battery: { voltage: 22.2 * (d.batteryStart / 100), remaining: d.batteryStart },
        gps: { fix_type: 3, satellites: 14 + (d.pathIndex % 5) },
      },
    ];
  }),
);

/** deviceId → { fcFirmware, frameType } for the grid tile + fleet-card badges. */
const DRONE_META: Record<string, { fcFirmware: string; frameType: string }> =
  Object.fromEntries(DEMO_DRONES.map((d) => [d.id, firmwareMeta(d.firmware)]));

/** Build the per-node Command cloud-status row for a demo agent. The companion
 * drone + the workstation + the ground station report host metrics (CPU/MEM/
 * temp); an FC-only drone does NOT (no onboard computer to report — Rule 44),
 * which also makes the grid tile render the compact flight-controller body. */
function buildDemoStatus(
  agent: PairedDrone,
  index: number,
  now: number,
): CommandCloudStatus {
  const base = {
    deviceId: agent.deviceId,
    version: agent.agentVersion,
    uptimeSeconds: 7_200 + index * 900,
    boardName: agent.board,
    boardArch: "arm64" as const,
    lastIp: agent.lastIp,
    videoState: "stopped" as const,
    videoWhepPort: 0,
    updatedAt: now,
  };
  const hostMetrics = {
    cpuPercent: 24 + (index % 6) * 6,
    memoryPercent: 40 + (index % 5) * 5,
    diskPercent: 30 + (index % 4) * 4,
    temperature: 46 + (index % 5) * 2,
  };

  if (agent.profile === "workstation") {
    return {
      ...base,
      ...hostMetrics,
      boardSoc: "workstation",
      fcConnected: false,
      fcPort: "",
      fcBaud: 0,
      mavlinkWsPort: 0,
      services: [
        { name: "ados-control", status: "running" },
        { name: "ados-compute", status: "running" },
      ],
    };
  }

  if (agent.profile === "ground-station") {
    return {
      ...base,
      ...hostMetrics,
      boardSoc: "ground-node",
      fcConnected: false,
      fcPort: "",
      fcBaud: 0,
      mavlinkWsPort: 0,
      services: [
        { name: "ados-control", status: "running" },
        { name: "ados-wfb-receiver", status: "running" },
        { name: "mediamtx-gs", status: "running" },
      ],
    };
  }

  // Drone. Only the companion-paired drone (board set) reports onboard-computer
  // metrics; an FC-only drone omits them so its tile stays honest + compact.
  const isCompanion = !!agent.board;
  return {
    ...base,
    ...(isCompanion ? hostMetrics : {}),
    boardSoc: isCompanion ? "companion" : "fc-only",
    fcConnected: true,
    fcPort: "/dev/ttyACM0",
    fcBaud: 115200,
    fcFirmware: DRONE_META[agent.deviceId]?.fcFirmware ?? "ardupilot",
    frameType: DRONE_META[agent.deviceId]?.frameType,
    mavlinkWsPort: 8765,
    services: isCompanion
      ? [
          { name: "ados-control", status: "running" },
          { name: "ados-mavlink", status: "running" },
          { name: "ados-video", status: "stopped" },
        ]
      : [{ name: "ados-mavlink", status: "running" }],
    telemetry: {
      ...DRONE_TELEMETRY[agent.deviceId],
      // Commands sent from a fleet surface land here, so a mode change or a
      // disarm made in demo shows up in the node's own telemetry rather than
      // being overwritten by the next tick.
      ...demoTelemetryOverride(agent.deviceId),
      last_update: now,
    },
  };
}

/** Seed the compute node's cluster + GPU snapshot (drives the workstation
 * overview compute cards + brand hero). `updatedAt` is refreshed each tick so
 * the cluster card's 15s staleness gate never trips in a running demo. */
function seedComputeStore(now: number): void {
  useComputeStore.getState().setCluster({
    role: "master",
    masterId: nodeIdForDevice(DEMO_WORKSTATION.deviceId),
    queueDepth: 1,
    activeJobs: 1,
    // Two drones are streaming frames here for perception offload — the "Serving
    // N sessions" line on the workstation's compute card.
    activeSessions: 2,
    workersIdle: 3,
    aggregateWorkersIdle: 5,
    slaves: [
      {
        nodeId: nodeIdForDevice("worker-01"),
        accelerators: ["cuda:0"],
        workersIdle: 2,
        queueDepth: 0,
      },
    ],
    updatedAt: now,
  });
  useComputeStore.getState().setGpu({
    name: "Apple M-series",
    cores: 40,
    unifiedMemoryMb: 65536,
    metal: "Metal 4",
    // A gentle wobble so the GPU sparkline reads as live rather than pinned.
    utilizationPct: 30 + Math.round(Math.random() * 18),
  });
}

/** Seed the ground-station store slices the GroundStationOverview cards read
 * (link health, uplink, paired drone, mesh role/health). */
function seedGroundStationStore(): void {
  useGroundStationStore.setState({
    status: {
      paired_drone: "alpha-1",
      profile: "ground_station",
      uplink_active: "ethernet",
    },
    linkHealth: {
      rssi_dbm: -58,
      bitrate_mbps: 18.5,
      fec_rec: 1240,
      fec_lost: 9,
      channel: 149,
    },
    uplink: {
      active: "ethernet",
      priority: ["ethernet", "wifi", "modem"],
      health: "ok",
      failover_log: [],
      data_cap: null,
      cloud_relay: {
        mqtt_connected: true,
        throttle_state: "ok",
        forwarding_video: true,
        forwarding_telemetry: true,
      },
      shareUplinkApplied: null,
      shareUplinkAppliedReason: null,
      loading: false,
      error: null,
    },
    role: {
      info: {
        current: "relay",
        configured: "relay",
        supported: ["direct", "relay", "receiver"],
        mesh_capable: true,
      },
      loading: false,
      switching: false,
      error: null,
    },
    mesh: {
      health: {
        up: true,
        peer_count: 2,
        selected_gateway: "gw-node-1",
        partition: false,
        mesh_id: "ados-mesh-01",
      },
      neighbors: [],
      routes: [],
      gateways: [],
      selectedGateway: null,
      lastTransientEvent: null,
      wsState: "connected",
      wsDisconnectedAt: null,
      loading: false,
      error: null,
    },
  });
}

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
function seedFocusedAgentSystem(now: number): void {
  const selId = useDroneManager.getState().selectedDroneId;
  const devId = selId ? (deviceIdFromNodeId(selId) ?? selId) : null;
  const agent = DEMO_AGENTS.find((a) => a.deviceId === devId) ?? DEMO_AGENTS[0];
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
function seedFocusedCapabilities(): void {
  const selId = useDroneManager.getState().selectedDroneId;
  const devId = selId ? (deviceIdFromNodeId(selId) ?? selId) : null;
  const agent = devId ? DEMO_AGENTS.find((a) => a.deviceId === devId) : undefined;
  if (!agent) return;
  const perception = demoPerceptionFor(agent);
  if (!perception) return;
  useAgentCapabilitiesStore
    .getState()
    .setCapabilities(getMockCapabilities("optical_flow", perception));
}

export function DemoProvider() {
  const demoMode = useSettingsStore((s) => s.demoMode);
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);

  // `drone-manager.selectDrone` resets the ground-station store (and video /
  // capability stores) on every node switch to stop one node's data bleeding
  // onto the next. In demo that wipes the ground-station overview data we seed
  // once below, so re-seed the profile-specific stores after each switch — the
  // workstation + ground-station overviews then stay populated whenever opened.
  // (The compute store is not reset on switch, but re-seeding it is harmless.)
  useEffect(() => {
    if (!hasHydrated || !demoMode) return;
    seedComputeStore(Date.now());
    seedGroundStationStore();
    seedFocusedAgentSystem(Date.now());
    seedFocusedCapabilities();
  }, [selectedDroneId, demoMode, hasHydrated]);

  useEffect(() => {
    if (!hasHydrated || !demoMode) return;

    let mounted = true;
    let engine: { start: (ms: number) => void; stop: () => void } | undefined;
    import("@/mock/engine").then((mod) => {
      if (!mounted) return;
      engine = mod.mockEngine;
      engine.start(200);
    });

    // Auto-connect the agent store in demo mode
    useAgentConnectionStore.getState().connect("mock://demo");
    usePairingStore.getState().setPairedDrones(DEMO_AGENTS);
    // Two drones paired over the LAN so the Nodes board shows the local-first
    // `lan` reach kind alongside cloud (Rule 39).
    seedDemoLanNodes(Date.now());

    // The workstation compute + jobs surfaces are a default on a workstation
    // (Atlas is its purpose), so they render without any flag. The drone World
    // Model is an opt-in per-node feature — the demo shows it off by default and
    // the operator turns it on from the Status-tab Features toggle.

    // Seed the profile-specific stores the workstation + ground-station
    // overviews read (the singleton agent-system store stays drone-flavored;
    // these carry the per-profile headline data).
    seedComputeStore(Date.now());
    seedGroundStationStore();
    seedFocusedAgentSystem(Date.now());
    seedFocusedCapabilities();

    const updateCommandFleetDemo = () => {
      const now = Date.now();
      const statuses: CommandCloudStatus[] = DEMO_AGENTS.map((agent, index) =>
        buildDemoStatus(agent, index, now),
      );
      useCommandFleetStore.getState().setCloudStatuses(statuses);
      for (const status of statuses) {
        if (status.telemetry) {
          useCommandFleetStore.getState().setTelemetry(status.deviceId, status.telemetry);
        }
      }
      usePairingStore.getState().setPairedDrones(
        DEMO_AGENTS.map((agent) => ({ ...agent, lastSeen: now })),
      );
      // Keep the compute cluster snapshot fresh (its card has a 15s staleness
      // gate), re-seed the focused node's agent-system status/resources (so the
      // Overview / Health / Logs tabs stay live), and feed the GPU sparkline.
      seedComputeStore(now);
      seedFocusedAgentSystem(now);
      const gpu = useComputeStore.getState().gpu;
      if (gpu?.utilizationPct != null) {
        useAgentSystemStore.getState().pushGpuUtilization(gpu.utilizationPct);
      }
    };

    updateCommandFleetDemo();
    const demoFleetInterval = setInterval(updateCommandFleetDemo, 2000);

    return () => {
      mounted = false;
      clearInterval(demoFleetInterval);
      engine?.stop();
      // Drop the demo profile override so a future real connection's mock
      // client (should one ever be constructed) reverts to its own defaults.
      setMockAgentOverride({ status: null, services: null, resources: null });
      useAgentConnectionStore.getState().disconnect();
      // `disconnect()` already clears the agent system store, but call
      // it again explicitly so a future refactor of the connection store
      // can't silently re-introduce a stale mock status on the screen.
      useAgentSystemStore.getState().clear();
      useDroneManager.getState().clear();
      useFleetStore.getState().setDrones([]);
      useFleetStore.getState().clearAlerts();
      usePairingStore.getState().clear();
      // Surgical: drop only the demo LAN nodes, never a real fleet's.
      clearDemoLanNodes();
      clearDemoNodeCommands();
      useCommandFleetStore.getState().clear();
      // The demo seeds the node registry (the single fleet write target);
      // clear it too so toggling demo off leaves no ghost rows for the
      // FleetProjectionBridge to re-project.
      useNodeRegistryStore.getState().clear();
      // Reset the profile-specific stores so demo leaves no residue in real mode.
      useComputeStore.getState().clear();
      useGroundStationStore.getState().resetAll();
    };
  }, [demoMode, hasHydrated]);

  // Residue sweep: if demo is off but demo plans leaked into the persisted plan
  // library (e.g. a `npm run demo` -> `npm run dev` reload while DemoMissionSync
  // never mounts), strip them so they can never surface in a real session. Gate
  // on the plan-library's own hydration, which is async and separate.
  // Strip any demo LAN nodes that leaked into the persisted local-nodes store
  // (e.g. a demo -> real reload where the mount cleanup never ran), gated on the
  // store's own async hydration so the strip runs after the persisted nodes
  // land. Keyed on the fixed demo deviceIds, so a real fleet's LAN nodes are
  // untouched.
  useEffect(() => {
    if (!hasHydrated || demoMode) return;
    if (useLocalNodesStore.persist.hasHydrated()) {
      clearDemoLanNodes();
      return;
    }
    return useLocalNodesStore.persist.onFinishHydration(clearDemoLanNodes);
  }, [demoMode, hasHydrated]);

  useEffect(() => {
    if (!hasHydrated || demoMode) return;
    const sweep = () => {
      const lib = usePlanLibraryStore.getState();
      if (!lib.plans.some((p) => isDemoPlanId(p.id)) && !lib.folders.some((f) => f.id === DEMO_MISSION_FOLDER_ID)) return;
      usePlanLibraryStore.setState((s) => ({
        plans: s.plans.filter((p) => !isDemoPlanId(p.id)),
        folders: s.folders.filter((f) => f.id !== DEMO_MISSION_FOLDER_ID),
        expandedFolders: s.expandedFolders.filter((id) => id !== DEMO_MISSION_FOLDER_ID),
        activePlanId: isDemoPlanId(s.activePlanId) ? null : s.activePlanId,
      }));
    };
    if (usePlanLibraryStore.persist.hasHydrated()) { sweep(); return; }
    return usePlanLibraryStore.persist.onFinishHydration(sweep);
  }, [demoMode, hasHydrated]);

  return hasHydrated && demoMode ? <DemoMissionSync /> : null;
}
