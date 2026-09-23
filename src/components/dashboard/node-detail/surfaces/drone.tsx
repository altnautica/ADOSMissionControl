/**
 * @module node-detail/surfaces/drone
 * @description Surfaces for a drone (flight-controller) node, in two tiers.
 *
 * A **Status** band answers "how is this node" — Overview (the node home:
 * identity, reach, health, the companion band, per-node actions), Flight (the
 * single live-telemetry + map surface) and Cockpit (full-bleed piloting).
 * A **Vehicle** band answers "how is this aircraft set up" — Setup, Parameters
 * and, when the node advertises a CRSF lane, RC/ELRS. Logs and the Agent page
 * follow ungrouped.
 *
 * The division of labour between Overview and Flight is deliberate and load
 * bearing: every LIVE reading lives on Flight, and Overview carries none of
 * them. The two used to answer the same question from different sources with
 * different freshness gating, so the same battery read three ways across two
 * adjacent tabs.
 * @license GPL-3.0-only
 */

import { DroneOverviewTab } from "@/components/drone-detail/DroneOverviewTab";
import { CockpitView } from "@/components/cockpit/CockpitView";
import { DroneOverview } from "@/components/command/overview/DroneOverview";
import { DroneConfigureTab } from "@/components/drone-detail/DroneConfigureTab";
import { LogsTab } from "@/components/drone-detail/LogsTab";
import { ParametersPanel } from "@/components/fc/parameters/ParametersPanel";
import { FcDisconnectedPlaceholder } from "@/components/fc/shared/FcDisconnectedPlaceholder";
import { RcElrsLinkTab } from "@/components/command/nodes/RcElrsLinkTab";
import type { SurfaceSpec } from "../surface-types";
import { surfaceNodeDeviceId } from "../surface-types";
import {
  STATUS_GROUP,
  VEHICLE_GROUP,
} from "../surface-groups";
import { AGENT_SURFACE } from "../agent/agent-surface";

export const DRONE_SURFACES: SurfaceSpec[] = [
  {
    // The node home: identity, reach, health, the companion band and the
    // per-node actions. Carries no live telemetry — that is Flight's job.
    id: "overview",
    labelKey: "dronePanel.overview",
    group: STATUS_GROUP,
    render: (ctx) => <DroneOverview ctx={ctx} />,
  },
  {
    // The single live-telemetry surface: instruments, the vehicle readouts and
    // the map. When this node has no CRSF lane of its own it also carries the
    // one RC channel card, so RC state has exactly one home either way.
    id: "flight",
    labelKey: "dronePanel.flight",
    group: STATUS_GROUP,
    render: (ctx) => (
      <DroneOverviewTab
        drone={ctx.drone}
        showRcCard={ctx.crsfPresent !== "present"}
      />
    ),
  },
  {
    // The immersive piloting cockpit (video + HUD + skill bar). Shown for every
    // drone; an FC-only drone with no video renders the OSD/telemetry over a
    // "no signal" state. "Immersive" collapses the dashboard chrome in place.
    id: "cockpit",
    labelKey: "dronePanel.cockpit",
    group: STATUS_GROUP,
    render: (ctx) => <CockpitView droneId={ctx.droneId} />,
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
