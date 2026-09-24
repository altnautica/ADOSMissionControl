/**
 * @module node-detail/agent/agent-nav-items
 * @description The Agent page's LIVE companion-computer sub-pages (Health /
 * Battery / Link / Perception / Cameras / Extensions / Logs).
 * Each item reuses the SurfaceContext shape and the same availability gate the
 * retired top-level surface used, and renders the exact same component one
 * level down.
 *
 * An entry carries only what a page *is* — id, label, icon, gate, body. Where
 * it sits in the sidebar, and which configuration page it sits beside, is
 * declared once in `agent-nav-sections`, which merges this registry with the
 * settings-page registry into the Agent page's single sidebar.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import {
  BatteryMedium,
  Camera,
  Eye,
  HeartPulse,
  Puzzle,
  RadioTower,
} from "lucide-react";
import { SystemTab } from "@/components/command/SystemTab";
import { PluginsTab } from "@/components/command/PluginsTab";
import { DroneRadioPanel } from "@/components/dashboard/DroneRadioPanel";
import { DroneVisionTab } from "@/components/drone-detail/DroneVisionTab";
import { CameraManagerTab } from "@/components/drone-detail/cameras/CameraManagerTab";
import { BatteryHealthPanel } from "@/components/drone-detail/BatteryHealthPanel";
import type { SurfaceContext } from "../surface-types";
import { surfaceNodeDeviceId } from "../surface-types";

export interface AgentNavItem {
  /** Stable id — matches the retired top-level surface id, so a persisted or
   * deep-linked tab keeps resolving through the panel's remap. */
  id: string;
  /** Full i18n path for the sidebar label. */
  labelKey: string;
  icon: ReactNode;
  /** Availability gate. Absent = always shown. */
  when?: (ctx: SurfaceContext) => boolean;
  render: (ctx: SurfaceContext) => ReactNode;
}

const isDrone = (ctx: SurfaceContext) =>
  (ctx.drone.profile ?? "drone") === "drone";
/** Hide for an FC-only node with no paired agent (nothing to show). Also the
 *  gate the whole settings half of the sidebar inherits — see
 *  `agent-nav-sections`. */
export const companionPresent = (ctx: SurfaceContext) => !ctx.showLockedTabs;
/** The GCS can talk to this node's agent — directly, or through its ground
 *  station's relay-proxy. Both lanes serve the same `/api/...` surface. */
const agentReachable = (ctx: SurfaceContext) =>
  ctx.agentDeviceId !== null || ctx.relayReach !== null;

export const AGENT_NAV_ITEMS: AgentNavItem[] = [
  {
    id: "system",
    labelKey: "dronePanel.health",
    icon: <HeartPulse size={14} />,
    when: companionPresent,
    render: (ctx) => (
      <SystemTab
        profile={ctx.drone.profile ?? "drone"}
        nodeDeviceId={surfaceNodeDeviceId(ctx)}
        relayReach={ctx.relayReach}
      />
    ),
  },
  {
    id: "battery",
    labelKey: "dronePanel.battery",
    icon: <BatteryMedium size={14} />,
    // Cell health, sag and time-to-reserve from the node's battery engine,
    // which reads the flight controller's battery reports — a drone concept.
    when: (ctx) => isDrone(ctx) && agentReachable(ctx),
    render: (ctx) => (
      <BatteryHealthPanel
        droneId={ctx.droneId}
        nodeDeviceId={surfaceNodeDeviceId(ctx)}
        relayReach={ctx.relayReach}
      />
    ),
  },
  {
    id: "radio",
    labelKey: "dronePanel.link",
    icon: <RadioTower size={14} />,
    // Air-side WFB link — a drone concept; a ground station has its own Link
    // tab. Gated on a PROVEN radio: `unknown` (no reading from this node yet)
    // is not `present`, so the page is never offered on a guess.
    when: (ctx) => isDrone(ctx) && ctx.radioPresent === "present",
    render: (ctx) => <DroneRadioPanel droneId={ctx.droneId} nodeDeviceId={surfaceNodeDeviceId(ctx)} />,
  },
  {
    id: "vision",
    labelKey: "dronePanel.perception",
    icon: <Eye size={14} />,
    when: (ctx) => isDrone(ctx) && agentReachable(ctx),
    render: (ctx) => (
      <DroneVisionTab droneId={ctx.droneId} nodeDeviceId={surfaceNodeDeviceId(ctx)} />
    ),
  },
  {
    id: "cameras",
    labelKey: "dronePanel.cameras",
    icon: <Camera size={14} />,
    // The node's camera roster — a companion-computer concept on a drone.
    when: (ctx) => isDrone(ctx) && companionPresent(ctx),
    render: (ctx) => <CameraManagerTab droneId={ctx.droneId} />,
  },
  {
    id: "plugins",
    labelKey: "dronePanel.extensions",
    icon: <Puzzle size={14} />,
    when: companionPresent,
    render: (ctx) => <PluginsTab ctx={ctx} />,
  },
];
