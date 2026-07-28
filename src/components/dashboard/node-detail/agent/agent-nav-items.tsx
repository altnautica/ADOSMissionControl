/**
 * @module node-detail/agent/agent-nav-items
 * @description The Agent page's LIVE companion-computer sub-pages (Health /
 * Link / Perception / Cameras / World Model / Live World / Extensions / Logs).
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
  Boxes,
  Camera,
  Eye,
  HeartPulse,
  Puzzle,
  Radar,
  RadioTower,
  ScrollText,
} from "lucide-react";
import { SystemTab } from "@/components/command/SystemTab";
import { PluginsTab } from "@/components/command/PluginsTab";
import { LogsTab } from "@/components/drone-detail/LogsTab";
import { DroneRadioPanel } from "@/components/dashboard/DroneRadioPanel";
import { DroneVisionTab } from "@/components/drone-detail/DroneVisionTab";
import { CameraManagerTab } from "@/components/drone-detail/cameras/CameraManagerTab";
import { DroneLiveWorldTab } from "@/components/drone-detail/DroneLiveWorldTab";
import { DroneWorldModelTab } from "@/components/drone-detail/DroneWorldModelTab";
import type { SurfaceContext } from "../surface-types";

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
    render: (ctx) => <SystemTab profile={ctx.drone.profile ?? "drone"} />,
  },
  {
    id: "radio",
    labelKey: "dronePanel.link",
    icon: <RadioTower size={14} />,
    // Air-side WFB link — a drone concept; a ground station has its own Link tab.
    when: (ctx) => isDrone(ctx) && ctx.radioPresent,
    render: (ctx) => <DroneRadioPanel droneId={ctx.droneId} />,
  },
  {
    id: "vision",
    labelKey: "dronePanel.perception",
    icon: <Eye size={14} />,
    when: (ctx) => isDrone(ctx) && agentReachable(ctx),
    render: (ctx) => <DroneVisionTab droneId={ctx.droneId} />,
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
    id: "world-model",
    labelKey: "dronePanel.worldModel",
    icon: <Boxes size={14} />,
    when: (ctx) =>
      isDrone(ctx) &&
      agentReachable(ctx) &&
      ctx.isFeatureEnabled("world-model"),
    render: (ctx) => <DroneWorldModelTab droneId={ctx.droneId} />,
  },
  {
    id: "live-world",
    labelKey: "dronePanel.liveWorld",
    icon: <Radar size={14} />,
    when: (ctx) =>
      isDrone(ctx) &&
      agentReachable(ctx) &&
      ctx.isFeatureEnabled("world-model") &&
      ctx.atlasCapturing,
    render: (ctx) => <DroneLiveWorldTab droneId={ctx.droneId} />,
  },
  {
    id: "plugins",
    labelKey: "dronePanel.extensions",
    icon: <Puzzle size={14} />,
    when: companionPresent,
    render: () => <PluginsTab />,
  },
  {
    // Always present: the Flights view reads the GCS history store and stays
    // reachable without a paired agent.
    id: "logs",
    labelKey: "dronePanel.logs",
    icon: <ScrollText size={14} />,
    render: (ctx) => (
      <LogsTab
        droneId={ctx.droneId}
        showFlights={(ctx.drone.profile ?? "drone") === "drone"}
      />
    ),
  },
];
