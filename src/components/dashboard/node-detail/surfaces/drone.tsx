/**
 * @module node-detail/surfaces/drone
 * @description Surfaces for a drone (flight-controller) node as a flat,
 * ungrouped strip: Status + Flight + Cockpit (monitoring), Setup + Parameters
 * (vehicle config), then the Agent page. The Agent page collapses the
 * companion-computer surfaces (Health / Link / Perception / World Model / Live
 * World / Settings / Extensions / Logs) behind one tab.
 * @license GPL-3.0-only
 */

import { DroneOverviewTab } from "@/components/drone-detail/DroneOverviewTab";
import { CockpitView } from "@/components/cockpit/CockpitView";
import { DroneOverview } from "@/components/command/overview/DroneOverview";
import { DroneConfigureTab } from "@/components/drone-detail/DroneConfigureTab";
import { ParametersPanel } from "@/components/fc/parameters/ParametersPanel";
import { FcDisconnectedPlaceholder } from "@/components/fc/shared/FcDisconnectedPlaceholder";
import { RcElrsLinkTab } from "@/components/command/nodes/RcElrsLinkTab";
import type { SurfaceSpec } from "../surface-types";
import { AGENT_SURFACE } from "../agent/agent-surface";

export const DRONE_SURFACES: SurfaceSpec[] = [
  {
    // The unified drone Overview (hero + FC band + companion band /
    // add-computer CTA).
    id: "overview",
    labelKey: "dronePanel.status",
    render: (ctx) => <DroneOverview ctx={ctx} />,
  },
  {
    // The flight instruments + map (left telemetry panel + right map view).
    id: "flight",
    labelKey: "dronePanel.flight",
    render: (ctx) => <DroneOverviewTab drone={ctx.drone} />,
  },
  {
    // The immersive piloting cockpit (video + HUD + skill bar). Shown for every
    // drone; an FC-only drone with no video renders the OSD/telemetry over a
    // "no signal" state. "Immersive" collapses the dashboard chrome in place.
    id: "cockpit",
    labelKey: "dronePanel.cockpit",
    render: (ctx) => <CockpitView droneId={ctx.droneId} />,
  },
  {
    id: "configure",
    labelKey: "dronePanel.setup",
    render: (ctx) => (
      <DroneConfigureTab
        droneId={ctx.droneId}
        droneName={ctx.displayName}
        isConnected={ctx.isConnected}
        fcLinking={ctx.fcLinking}
        agentBacked={ctx.agentIdentityKnown === true || ctx.agentDeviceId !== null}
      />
    ),
  },
  {
    id: "parameters",
    labelKey: "dronePanel.parameters",
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
    // ELRS transmitter. Capability-gated: hidden unless the agent advertises a
    // crsf block.
    id: "rcElrs",
    labelKey: "rcElrsLink.tabLabel",
    when: (ctx) => ctx.crsfPresent,
    render: () => <RcElrsLinkTab />,
  },
  AGENT_SURFACE,
];
