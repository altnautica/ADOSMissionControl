/**
 * @module node-detail/surfaces/ground-station
 * @description Surfaces for a ground-station node in two tiers.
 *
 * A **Status** band — overview, the received-video cockpit and the drones this
 * box carries. A
 * **Link** band — the ground radio, IP networking, the mesh and its
 * distributed-receive data plane, GNSS and the LoRa lane when fitted, and the
 * RC/ELRS control lane. A **Device** band — the physical box: display,
 * buttons, peripherals (shared with the Visor). Then Logs and the Agent page.
 *
 * Mesh and Distributed RX used to be two role-gated tabs polling `/role`
 * separately and each rendering a role picker, both hidden unless the node
 * was ALREADY a relay or receiver — so the only role picker in node detail
 * was unreachable from exactly the `direct` and `unset` nodes that needed it.
 * They are one always-present "Mesh & RX" surface.
 *
 * Controls drive the agent REST surface; in demo the surface reads the seeded
 * ground-station store (the demo agent URL has no REST endpoint, so the tabs'
 * polls no-op — see groundStationApiFromAgent). Demo WRITES are inert and say
 * so rather than swallowing the click. Mesh & RX is the exception: it drives an
 * in-memory demo mesh client (see meshApiFromAgent), so its role switch and
 * receiver pairing window work in demo.
 * @license GPL-3.0-only
 */

import dynamic from "next/dynamic";
import type { SurfaceSpec } from "../surface-types";
import { surfaceNodeDeviceId } from "../surface-types";
import { STATUS_GROUP, LINK_GROUP } from "../surface-groups";
import { deviceSurfaces } from "./device";
import { AGENT_SURFACE } from "../agent/agent-surface";
import { DashboardPinUnlockCard } from "@/components/command/nodes/ground-station/DashboardPinUnlockCard";

// Every tab body loads on first open: the panel renders one at a time.
const GroundStationOverview = dynamic(() =>
  import("@/components/command/overview/GroundStationOverview").then(
    (m) => m.GroundStationOverview,
  ),
);
const GroundStationCockpit = dynamic(() =>
  import("@/components/cockpit/GroundStationCockpit").then((m) => m.GroundStationCockpit),
);
const CarriedDronesTab = dynamic(() =>
  import("@/components/command/nodes/ground-station/CarriedDronesTab").then(
    (m) => m.CarriedDronesTab,
  ),
);
const RadioTab = dynamic(() =>
  import("@/components/command/nodes/ground-station/RadioTab").then((m) => m.RadioTab),
);
const NetworkTab = dynamic(() =>
  import("@/components/command/nodes/ground-station/NetworkTab").then((m) => m.NetworkTab),
);
const MeshTab = dynamic(() =>
  import("@/components/command/nodes/ground-station/MeshTab").then((m) => m.MeshTab),
);
const RcElrsLinkTab = dynamic(() =>
  import("@/components/command/nodes/RcElrsLinkTab").then((m) => m.RcElrsLinkTab),
);
const GnssTab = dynamic(() =>
  import("@/components/command/nodes/ground-station/GnssTab").then((m) => m.GnssTab),
);
const LoraTab = dynamic(() =>
  import("@/components/command/nodes/ground-station/LoraTab").then((m) => m.LoraTab),
);
const LogsTab = dynamic(() =>
  import("@/components/drone-detail/LogsTab").then((m) => m.LogsTab),
);

export const GROUND_STATION_SURFACES: SurfaceSpec[] = [
  {
    id: "overview",
    labelKey: "dronePanel.overview",
    group: STATUS_GROUP,
    // An unpaired node needs its dashboard PIN before any tab can read it.
    render: (ctx) => (
      <>
        <DashboardPinUnlockCard nodeDeviceId={surfaceNodeDeviceId(ctx)} />
        <GroundStationOverview name={ctx.displayName} nodeDeviceId={surfaceNodeDeviceId(ctx)} />
      </>
    ),
  },
  {
    // A ground station flies the drone it carries: its Flight tab hands over
    // to that drone's cockpit, or says no drone is linked. Shown for every
    // ground node (no role gate).
    id: "cockpit",
    labelKey: "dronePanel.flight",
    group: STATUS_GROUP,
    render: (ctx) => <GroundStationCockpit groundDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    // The aircraft this box is relaying, and the authority it holds over
    // each. Reach used to be modelled only from the drone's side.
    id: "carriedDrones",
    labelKey: "groundStationOverview.carriedDrones.title",
    group: STATUS_GROUP,
    render: (ctx) => <CarriedDronesTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    id: "radio",
    labelKey: "command.groundStation.tabs.radio",
    group: LINK_GROUP,
    when: (ctx) => ctx.role !== "receiver",
    render: (ctx) => <RadioTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    id: "network",
    labelKey: "command.groundStation.tabs.network",
    group: LINK_GROUP,
    render: (ctx) => <NetworkTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    // Fix, RTK base and PPS time from the box's own receiver. Shown only on a
    // proven `gnss` capability: a box with no receiver never gets the tab.
    id: "gnss",
    labelKey: "command.groundStation.tabs.gnss",
    group: LINK_GROUP,
    when: (ctx) => ctx.gnssPresent === "present",
    render: (ctx) => <GnssTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    // The low-duty LoRa beacon lane and its regional duty governor.
    id: "lora",
    labelKey: "command.groundStation.tabs.lora",
    group: LINK_GROUP,
    when: (ctx) => ctx.loraPresent === "present",
    render: (ctx) => <LoraTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    // Mesh control plane + distributed-RX data plane, and the node's one role
    // picker. Always present: a `direct` or `unset` node reaches the picker
    // here, which is the whole point.
    id: "mesh",
    labelKey: "command.groundStation.tabs.meshAndRx",
    group: LINK_GROUP,
    render: (ctx) => <MeshTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    // Capability-gated on a PROVEN crsf lane: `unknown` is not `present`, so
    // the tab is never advertised on a reading we do not have.
    id: "rcElrs",
    labelKey: "rcElrsLink.tabLabel",
    group: LINK_GROUP,
    when: (ctx) => ctx.crsfPresent === "present",
    render: (ctx) => <RcElrsLinkTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  ...deviceSurfaces("ground_station"),
  {
    id: "logs",
    labelKey: "dronePanel.logs",
    render: (ctx) => (
      <LogsTab droneId={ctx.droneId} nodeDeviceId={surfaceNodeDeviceId(ctx)} showFlights={false} directReach={ctx.agentDeviceId !== null} />
    ),
  },
  AGENT_SURFACE,
];
