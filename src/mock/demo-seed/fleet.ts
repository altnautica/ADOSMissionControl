/**
 * @module mock/demo-seed/fleet
 * @description The demo fleet roster (paired agents, LAN-paired nodes) and the per-node
 * status rows the Command fleet store is fed on every demo tick.
 * @license GPL-3.0-only
 */

import { DEMO_LAN_NODE_IDS } from "@/lib/demo/demo-ids";
import type { PairedDrone } from "@/stores/pairing-store";
import { demoTelemetryOverride } from "@/mock/demo-node-commands";
import type { CommandCloudStatus } from "@/stores/command-fleet-store";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { nodeIdForDevice } from "@/lib/agent/node-id";
import { DEMO_DRONES, DEMO_WORKSTATION, DEMO_GROUND_STATION, firmwareMeta } from "@/mock/drones";

export const AGENT_VERSION = "0.99.80";

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

export const DEMO_AGENTS: PairedDrone[] = [
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
 * so the Nodes board shows the local-first `lan` reach kind (local-first) — not
 * just cloud-relay. They shadow their cloud-paired rows (same deviceId), so the
 * LAN transport wins over cloud for those two. Generic private hostnames (no
 * real lab host). Their `deviceId`s are the removal keys the demo teardown +
 * residue sweep use, so a real fleet's LAN nodes are never touched. */
const DEMO_LAN_NODES: Array<Omit<LocalNode, "pairedAt" | "lastSeenAt">> = [
  {
    deviceId: DEMO_LAN_NODE_IDS[0],
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
    deviceId: DEMO_LAN_NODE_IDS[1],
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
export function seedDemoLanNodes(now: number): void {
  const store = useLocalNodesStore.getState();
  for (const node of DEMO_LAN_NODES) {
    store.addNode({ ...node, pairedAt: now, lastSeenAt: now });
  }
}

/** Per-drone flight telemetry for the Command grid tiles (the map itself is fed
 * by the live mock engine through the node registry). Derived from DEMO_DRONES so
 * the roster stays in sync; ground vehicles read ~0 altitude and the sub a
 * negative depth (an honest per-airframe reading). */
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
 * temp); an FC-only drone does NOT (no onboard computer to report — no fabricated reading),
 * which also makes the grid tile render the compact flight-controller body. */
export function buildDemoStatus(
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
        { name: "ados-plugin-host", status: "running" },
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
      // A verified WFB link (received-side proof) so the transitive-enrollment
      // bridge (RelayedDroneBridge) treats the ground node as radio-up and
      // surfaces the funneled feed for the drones it relays (no fabricated reading).
      radio: {
        state: "connected",
        iface: "wlan1",
        channel: 149,
        band: "u-nii-3",
        rssiDbm: -58,
        bitrateKbps: 18500,
        linkDiag: "healthy",
        validRxPacketsPerS: 312,
        rfUnverified: false,
        paired: true,
      },
      // The WFB peers this ground node relays. romeo-15 + whiskey-23 are NOT
      // otherwise paired, so each transitively enrolls as its own "linked via
      // WFB through <GS>" node (romeo-15 fresh + strong = a verified funneled
      // feed; whiskey-23 old + weak = an honest down relay). alpha-1 IS also
      // cloud-paired, so it keeps its direct reach and shows the WFB path as a
      // secondary provenance chip.
      linkedPeers: [
        {
          deviceId: "romeo-15",
          role: "drone",
          rssiDbm: -63,
          channel: 149,
          seenAtUnix: Math.floor(now / 1000),
        },
        {
          deviceId: "whiskey-23",
          role: "drone",
          rssiDbm: -90,
          channel: 149,
          seenAtUnix: Math.floor((now - 180_000) / 1000),
        },
        {
          deviceId: "alpha-1",
          role: "drone",
          rssiDbm: -55,
          channel: 149,
          seenAtUnix: Math.floor(now / 1000),
        },
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
