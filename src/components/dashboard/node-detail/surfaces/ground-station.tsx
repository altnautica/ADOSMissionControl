/**
 * @module node-detail/surfaces/ground-station
 * @description Surfaces for a ground-station node in two-tier order, role-gated
 * (direct / relay / receiver): a Status section (its overview), a Link section
 * (ground-side radio + network/uplink + mesh + distributed RX), a Device
 * section (local display + buttons + peripherals), then the Agent page that
 * collapses the companion-computer surfaces (Health / Settings / Extensions /
 * Logs). Controls drive the agent REST surface; in demo the surface reads the
 * seeded ground-station store (the demo agent URL has no REST endpoint, so the
 * tabs' load-on-mount polls no-op — see groundStationApiFromAgent).
 * @license GPL-3.0-only
 */

import { GroundStationOverview } from "@/components/command/overview/GroundStationOverview";
import { RadioTab } from "@/components/command/nodes/ground-station/RadioTab";
import { NetworkTab } from "@/components/command/nodes/ground-station/NetworkTab";
import { DisplayTab } from "@/components/command/nodes/ground-station/DisplayTab";
import { PhysicalUiTab } from "@/components/command/nodes/ground-station/PhysicalUiTab";
import { PeripheralsTab } from "@/components/command/nodes/ground-station/PeripheralsTab";
import { MeshTab } from "@/components/command/nodes/ground-station/MeshTab";
import { DistributedRxTab } from "@/components/command/nodes/ground-station/DistributedRxTab";
import { GroundStationAtlasRelay } from "@/components/command/nodes/ground-station/GroundStationAtlasRelay";
import { RcElrsLinkTab } from "@/components/command/nodes/RcElrsLinkTab";
import type { SurfaceSpec, SurfaceContext } from "../surface-types";
import { AGENT_SURFACE } from "../agent/agent-surface";

// Role gates mirror the prior GroundStationDetailPanel.visibleTabsForRole:
// a receiver hides Radio (RX-only); a direct node (and unknown / null role)
// hides Mesh + Distributed RX (solo node).
const hasMesh = (ctx: SurfaceContext) =>
  ctx.role === "relay" || ctx.role === "receiver";

const STATUS_GROUP = "command.groundStation.groups.status";
const LINK_GROUP = "command.groundStation.groups.link";
const DEVICE_GROUP = "command.groundStation.groups.device";

export const GROUND_STATION_SURFACES: SurfaceSpec[] = [
  {
    id: "overview",
    labelKey: "dronePanel.status",
    group: STATUS_GROUP,
    // Read-only summary over the demo-seeded ground-station store (link /
    // uplink / mesh cards).
    render: (ctx) => <GroundStationOverview name={ctx.displayName} />,
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
    render: () => <NetworkTab />,
  },
  {
    id: "mesh",
    labelKey: "command.groundStation.tabs.mesh",
    group: LINK_GROUP,
    when: hasMesh,
    render: () => <MeshTab />,
  },
  {
    id: "distributedRx",
    labelKey: "command.groundStation.tabs.distributedRx",
    group: LINK_GROUP,
    when: hasMesh,
    render: () => <DistributedRxTab />,
  },
  {
    id: "atlasRelay",
    labelKey: "atlas.atlasRelay",
    group: LINK_GROUP,
    // Opt-in per ground station (off by default). The World Model relay is the
    // GS's side of a drone's Atlas capture, not a default GS surface.
    when: (ctx) => ctx.isFeatureEnabled("world-model"),
    render: () => <GroundStationAtlasRelay />,
  },
  {
    id: "rcElrs",
    labelKey: "rcElrsLink.tabLabel",
    group: LINK_GROUP,
    // Capability-gated: the ground node is the ELRS transmitter, but the tab
    // appears only when the agent advertises a crsf control lane. Driven by the
    // capability store (not the GS REST API), so it renders directly rather
    // than through the demo-notice body.
    when: (ctx) => ctx.crsfPresent,
    render: () => <RcElrsLinkTab />,
  },
  {
    id: "display",
    labelKey: "command.groundStation.tabs.display",
    group: DEVICE_GROUP,
    render: () => <DisplayTab />,
  },
  {
    id: "physicalUi",
    labelKey: "dronePanel.buttons",
    group: DEVICE_GROUP,
    render: () => <PhysicalUiTab />,
  },
  {
    id: "peripherals",
    labelKey: "command.groundStation.tabs.peripherals",
    group: DEVICE_GROUP,
    render: () => <PeripheralsTab />,
  },
  AGENT_SURFACE,
];
