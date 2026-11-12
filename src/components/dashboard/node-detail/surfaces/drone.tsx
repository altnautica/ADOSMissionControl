/**
 * @module node-detail/surfaces/drone
 * @description Surfaces for a drone (flight-controller) node, in two tiers.
 *
 * A **Status** band answers "how is this node" — Overview (the node home:
 * identity, reach, health, the companion band, the vehicle readouts and
 * per-node actions), Flight (the embedded piloting cockpit) and, with a
 * companion agent, Map (the companion's local map and its status).
 * A **Vehicle** band answers "how is this aircraft set up" — Setup, Parameters
 * and, when the node advertises a CRSF lane, RC/ELRS. Logs and the Agent page
 * follow ungrouped.
 * @license GPL-3.0-only
 */

import dynamic from "next/dynamic";
import { FcDisconnectedPlaceholder } from "@/components/fc/shared/FcDisconnectedPlaceholder";
import type { SurfaceSpec } from "../surface-types";
import { surfaceNodeDeviceId } from "../surface-types";
import {
  STATUS_GROUP,
  VEHICLE_GROUP,
} from "../surface-groups";
import { AGENT_SURFACE } from "../agent/agent-surface";

// Every tab body loads on first open: the panel renders one at a time, and the
// cockpit, parameter table and configure pages are each heavy.
const DroneOverview = dynamic(() =>
  import("@/components/command/overview/DroneOverview").then((m) => m.DroneOverview),
);
const CockpitView = dynamic(() =>
  import("@/components/cockpit/CockpitView").then((m) => m.CockpitView),
);
const DroneConfigureTab = dynamic(() =>
  import("@/components/drone-detail/DroneConfigureTab").then((m) => m.DroneConfigureTab),
);
const ParametersPanel = dynamic(() =>
  import("@/components/fc/parameters/ParametersPanel").then((m) => m.ParametersPanel),
);
const RcElrsLinkTab = dynamic(() =>
  import("@/components/command/nodes/RcElrsLinkTab").then((m) => m.RcElrsLinkTab),
);
const LogsTab = dynamic(() =>
  import("@/components/drone-detail/LogsTab").then((m) => m.LogsTab),
);
const DroneMapTab = dynamic(() =>
  import("@/components/drone-detail/map/DroneMapTab").then((m) => m.DroneMapTab),
);

export const DRONE_SURFACES: SurfaceSpec[] = [
  {
    // The node home: identity, reach, health, the companion band and the
    // per-node actions, plus the vehicle readouts and status text below the
    // FC band. Live piloting lives on Flight.
    id: "overview",
    labelKey: "dronePanel.overview",
    group: STATUS_GROUP,
    render: (ctx) => <DroneOverview ctx={ctx} />,
  },
  {
    // Flight: the piloting cockpit (video + HUD + skill bar), embedded in the
    // tab and taken full screen from its own top bar. Shown for every drone;
    // an FC-only drone with no video renders the OSD/telemetry over a "no
    // signal" state. The id stays `cockpit`, so every entry point that opens
    // the cockpit lands here.
    id: "cockpit",
    labelKey: "dronePanel.flight",
    group: STATUS_GROUP,
    render: (ctx) => <CockpitView droneId={ctx.droneId} />,
  },
  {
    // The companion's local map: world-engine status, the 3D viewer launch
    // and the live local-frame map. Needs a companion agent; a bare flight
    // controller has no map source.
    id: "map",
    labelKey: "hud.mapTab.title",
    group: STATUS_GROUP,
    when: (ctx) => ctx.agentIdentityKnown,
    render: (ctx) => <DroneMapTab droneId={ctx.droneId} pluginAgentPages={ctx.pluginAgentPages} />,
  },
  {
    id: "configure",
    labelKey: "dronePanel.setup",
    group: VEHICLE_GROUP,
    render: (ctx) => (
      <DroneConfigureTab
        droneId={ctx.droneId}
        droneName={ctx.displayName}
        isConnected={ctx.isConnected}
        fcLinking={ctx.fcLinking}
        agentBacked={ctx.agentIdentityKnown === true || ctx.agentDeviceId !== null}
        nodeDeviceId={surfaceNodeDeviceId(ctx)}
      />
    ),
  },
  {
    id: "parameters",
    labelKey: "dronePanel.parameters",
    group: VEHICLE_GROUP,
    render: (ctx) =>
      ctx.isConnected ? (
        <ParametersPanel />
      ) : (
        <FcDisconnectedPlaceholder
          droneName={ctx.displayName}
          agentBacked={ctx.agentIdentityKnown === true || ctx.agentDeviceId !== null}
        />
      ),
  },
  {
    // The RC / ExpressLRS control lane, when this node hosts an agent-relay
    // ELRS transmitter. Capability-gated on a PROVEN lane: `unknown` (this
    // browser has never heard the node describe itself) is not `present`, so
    // the tab is never advertised on a reading we do not have.
    id: "rcElrs",
    labelKey: "rcElrsLink.tabLabel",
    group: VEHICLE_GROUP,
    when: (ctx) => ctx.crsfPresent === "present",
    render: (ctx) => <RcElrsLinkTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    // Top level on every profile: "what happened on this node" is a first
    // question, not a configuration sub-page. It needs no companion — the
    // flight history is the GCS's own.
    id: "logs",
    labelKey: "dronePanel.logs",
    render: (ctx) => (
      <LogsTab droneId={ctx.droneId} nodeDeviceId={surfaceNodeDeviceId(ctx)} showFlights />
    ),
  },
  AGENT_SURFACE,
];
