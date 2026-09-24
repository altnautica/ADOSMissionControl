/**
 * @module node-detail/surfaces/ground-station
 * @description Surfaces for a ground-station node in two tiers.
 *
 * A **Status** band — overview, the received-video cockpit and the drones this
 * box carries. A
 * **Link** band — the ground radio, IP networking, the mesh and its
 * distributed-receive data plane, and the RC/ELRS control lane. A **Device**
 * band — the physical box: display, buttons, peripherals. Then Logs and the
 * Agent page.
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
 * so rather than swallowing the click.
 * @license GPL-3.0-only
 */

import { GroundStationOverview } from "@/components/command/overview/GroundStationOverview";
import { CockpitView } from "@/components/cockpit/CockpitView";
import { RadioTab } from "@/components/command/nodes/ground-station/RadioTab";
import { NetworkTab } from "@/components/command/nodes/ground-station/NetworkTab";
import { DisplayTab } from "@/components/command/nodes/ground-station/DisplayTab";
import { PhysicalUiTab } from "@/components/command/nodes/ground-station/PhysicalUiTab";
import { PeripheralsTab } from "@/components/command/nodes/ground-station/PeripheralsTab";
import { MeshTab } from "@/components/command/nodes/ground-station/MeshTab";
import { CarriedDronesTab } from "@/components/command/nodes/ground-station/CarriedDronesTab";
import { RcElrsLinkTab } from "@/components/command/nodes/RcElrsLinkTab";
import { LogsTab } from "@/components/drone-detail/LogsTab";
import type { SurfaceSpec } from "../surface-types";
import { surfaceNodeDeviceId } from "../surface-types";
import { STATUS_GROUP, LINK_GROUP, DEVICE_GROUP } from "../surface-groups";
import { AGENT_SURFACE } from "../agent/agent-surface";

export const GROUND_STATION_SURFACES: SurfaceSpec[] = [
  {
    id: "overview",
    labelKey: "dronePanel.overview",
    group: STATUS_GROUP,
    render: (ctx) => <GroundStationOverview name={ctx.displayName} />,
  },
  {
    // The immersive piloting cockpit (received video + HUD + skill bar). A
    // ground station has no local video/detections, so it degrades to a clean
    // no-signal state rather than fabricating boxes. Shown for every ground
    // node (no role gate).
    id: "cockpit",
    labelKey: "dronePanel.cockpit",
    group: STATUS_GROUP,
    render: (ctx) => <CockpitView droneId={ctx.droneId} />,
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
    render: () => <RadioTab />,
  },
  {
    id: "network",
    labelKey: "command.groundStation.tabs.network",
    group: LINK_GROUP,
    render: (ctx) => <NetworkTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    // Mesh control plane + distributed-RX data plane, and the node's one role
    // picker. Always present: a `direct` or `unset` node reaches the picker
    // here, which is the whole point.
    id: "mesh",
    labelKey: "command.groundStation.tabs.meshAndRx",
    group: LINK_GROUP,
    render: () => <MeshTab />,
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
  {
    id: "display",
    labelKey: "command.groundStation.tabs.display",
    group: DEVICE_GROUP,
    render: (ctx) => <DisplayTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    id: "physicalUi",
    labelKey: "dronePanel.buttons",
    group: DEVICE_GROUP,
    render: (ctx) => <PhysicalUiTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    id: "peripherals",
    labelKey: "command.groundStation.tabs.peripherals",
    group: DEVICE_GROUP,
    render: () => <PeripheralsTab />,
  },
  {
    id: "logs",
    labelKey: "dronePanel.logs",
    render: (ctx) => (
      <LogsTab droneId={ctx.droneId} nodeDeviceId={surfaceNodeDeviceId(ctx)} showFlights={false} />
    ),
  },
  AGENT_SURFACE,
];
