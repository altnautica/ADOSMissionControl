/**
 * @module node-detail/surfaces/visor
 * @description Surfaces for a Visor (handheld capture rig) node.
 *
 * A **Status** band — the Overview; the capture extension's Capture (order 20)
 * and Sessions (order 30) pages join it after the Overview. A **Device** band —
 * the rig's Sensors first, the extension's Calibration (order 20) next, then
 * the box's display, buttons and peripherals shared with the ground station.
 * Then Logs and the Agent page. The `order` hints place the extension pages;
 * without the extension the Visor shows only these core surfaces.
 * @license GPL-3.0-only
 */

import dynamic from "next/dynamic";
import type { SurfaceSpec } from "../surface-types";
import { surfaceNodeDeviceId } from "../surface-types";
import { STATUS_GROUP, DEVICE_GROUP } from "../surface-groups";
import { AGENT_SURFACE } from "../agent/agent-surface";
import { deviceSurfaces } from "./device";
import { DashboardPinUnlockCard } from "@/components/command/nodes/ground-station/DashboardPinUnlockCard";

const VisorOverview = dynamic(() =>
  import("@/components/command/overview/VisorOverview").then((m) => m.VisorOverview),
);
const SensorsTab = dynamic(() =>
  import("@/components/command/nodes/visor/SensorsTab").then((m) => m.SensorsTab),
);
const LogsTab = dynamic(() =>
  import("@/components/drone-detail/LogsTab").then((m) => m.LogsTab),
);

export const VISOR_SURFACES: SurfaceSpec[] = [
  {
    id: "overview",
    labelKey: "dronePanel.overview",
    group: STATUS_GROUP,
    order: 10,
    render: (ctx) => (
      <>
        <DashboardPinUnlockCard nodeDeviceId={surfaceNodeDeviceId(ctx)} />
        <VisorOverview name={ctx.displayName} nodeDeviceId={surfaceNodeDeviceId(ctx)} />
      </>
    ),
  },
  {
    id: "sensors",
    labelKey: "visor.sensors.tabLabel",
    group: DEVICE_GROUP,
    order: 10,
    render: (ctx) => <SensorsTab nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  // Display, buttons, peripherals at orders 30/40/50, so the extension's
  // Calibration (order 20) lands between Sensors and Display.
  ...deviceSurfaces("visor").map((spec, i) => ({ ...spec, order: 30 + i * 10 })),
  {
    id: "logs",
    labelKey: "dronePanel.logs",
    render: (ctx) => (
      <LogsTab droneId={ctx.droneId} nodeDeviceId={surfaceNodeDeviceId(ctx)} showFlights={false} directReach={ctx.agentDeviceId !== null} />
    ),
  },
  AGENT_SURFACE,
];
