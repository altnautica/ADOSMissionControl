/**
 * @module node-detail/surfaces/workstation
 * @description Surfaces for a workstation (and compute) node: the host
 * Overview, Logs, and the Agent page. A workstation is a core shell; the pages
 * that give it a purpose come from the extensions installed on it, whose node
 * surfaces follow the Overview.
 * @license GPL-3.0-only
 */

import { SystemTab } from "@/components/command/SystemTab";
import { LogsTab } from "@/components/drone-detail/LogsTab";
import { surfaceNodeDeviceId, type SurfaceSpec } from "../surface-types";
import { STATUS_GROUP } from "../surface-groups";
import { AGENT_SURFACE } from "../agent/agent-surface";

export const WORKSTATION_SURFACES: SurfaceSpec[] = [
  {
    id: "overview",
    labelKey: "dronePanel.overview",
    group: STATUS_GROUP,
    render: (ctx) => (
      <SystemTab
        profile={ctx.drone.profile ?? "workstation"}
        nodeDeviceId={surfaceNodeDeviceId(ctx)}
        relayReach={ctx.relayReach}
      />
    ),
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
