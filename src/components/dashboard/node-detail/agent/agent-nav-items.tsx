/**
 * @module node-detail/agent/agent-nav-items
 * @description The Agent page sub-page registry: the companion-computer surfaces
 * (Health / Link / Perception / World Model / Live World / Settings / Extensions
 * / Logs) collapsed behind the Agent tab, grouped into System / Perception /
 * Software sections. Each item reuses the SurfaceContext shape and the same
 * availability gate the top-level surface used before, and renders the exact
 * same component one level down.
 * @license GPL-3.0-only
 */
// Exempt from 300 LOC soft rule: sub-page registry data file.

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
  SlidersHorizontal,
} from "lucide-react";
import { SystemTab } from "@/components/command/SystemTab";
import { PluginsTab } from "@/components/command/PluginsTab";
import { NodeSettingsTab } from "@/components/command/settings/NodeSettingsTab";
import { LogsTab } from "@/components/drone-detail/LogsTab";
import { DroneRadioPanel } from "@/components/dashboard/DroneRadioPanel";
import { DroneVisionTab } from "@/components/drone-detail/DroneVisionTab";
import { CameraManagerTab } from "@/components/drone-detail/cameras/CameraManagerTab";
import { DroneLiveWorldTab } from "@/components/drone-detail/DroneLiveWorldTab";
import { DroneWorldModelTab } from "@/components/drone-detail/DroneWorldModelTab";
import type { SurfaceContext } from "../surface-types";

/** The three Agent-page sections, top -> bottom. Values are full i18n paths. */
export const AGENT_SECTIONS = {
  system: "dronePanel.agentGroups.system",
  perception: "dronePanel.agentGroups.perception",
  software: "dronePanel.agentGroups.software",
} as const;

export type AgentSectionKey = keyof typeof AGENT_SECTIONS;

export interface AgentNavItem {
  /** Stable id — matches the retired top-level surface id, so a persisted or
   * deep-linked tab keeps resolving through the panel's remap. */
  id: string;
  /** Full i18n path for the sidebar label. */
  labelKey: string;
  section: AgentSectionKey;
  icon: ReactNode;
  /** Availability gate. Absent = always shown. */
  when?: (ctx: SurfaceContext) => boolean;
  render: (ctx: SurfaceContext) => ReactNode;
}

const isDrone = (ctx: SurfaceContext) =>
  (ctx.drone.profile ?? "drone") === "drone";
/** Hide for an FC-only node with no paired agent (nothing to show). */
const companionPresent = (ctx: SurfaceContext) => !ctx.showLockedTabs;
/** The GCS can talk to this node's agent — directly, or through its ground
 *  station's relay-proxy. Both lanes serve the same `/api/...` surface. */
const agentReachable = (ctx: SurfaceContext) =>
  ctx.agentDeviceId !== null || ctx.relayReach !== null;

export const AGENT_NAV_ITEMS: AgentNavItem[] = [
  // SYSTEM
  {
    id: "system",
    labelKey: "dronePanel.health",
    section: "system",
    icon: <HeartPulse size={14} />,
    when: companionPresent,
    render: (ctx) => <SystemTab profile={ctx.drone.profile ?? "drone"} />,
  },
  {
    id: "radio",
    labelKey: "dronePanel.link",
    section: "system",
    icon: <RadioTower size={14} />,
    // Air-side WFB link — a drone concept; a ground station has its own Link tab.
    when: (ctx) => isDrone(ctx) && ctx.radioPresent,
    render: (ctx) => <DroneRadioPanel droneId={ctx.droneId} />,
  },
  // PERCEPTION
  {
    id: "vision",
    labelKey: "dronePanel.perception",
    section: "perception",
    icon: <Eye size={14} />,
    when: (ctx) => isDrone(ctx) && agentReachable(ctx),
    render: (ctx) => <DroneVisionTab droneId={ctx.droneId} />,
  },
  {
    id: "cameras",
    labelKey: "dronePanel.cameras",
    section: "perception",
    icon: <Camera size={14} />,
    // The node's camera roster — a companion-computer concept on a drone.
    when: (ctx) => isDrone(ctx) && companionPresent(ctx),
    render: (ctx) => <CameraManagerTab droneId={ctx.droneId} />,
  },
  {
    id: "world-model",
    labelKey: "dronePanel.worldModel",
    section: "perception",
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
    section: "perception",
    icon: <Radar size={14} />,
    when: (ctx) =>
      isDrone(ctx) &&
      agentReachable(ctx) &&
      ctx.isFeatureEnabled("world-model") &&
      ctx.atlasCapturing,
    render: (ctx) => <DroneLiveWorldTab droneId={ctx.droneId} />,
  },
  // SOFTWARE
  {
    id: "settings",
    labelKey: "dronePanel.settings",
    section: "software",
    icon: <SlidersHorizontal size={14} />,
    when: companionPresent,
    render: (ctx) => (
      <NodeSettingsTab
        droneId={ctx.droneId}
        profile={ctx.drone.profile ?? "drone"}
      />
    ),
  },
  {
    id: "plugins",
    labelKey: "dronePanel.extensions",
    section: "software",
    icon: <Puzzle size={14} />,
    when: companionPresent,
    render: () => <PluginsTab />,
  },
  {
    // Always present: the Flights view reads the GCS history store and stays
    // reachable without a paired agent.
    id: "logs",
    labelKey: "dronePanel.logs",
    section: "software",
    icon: <ScrollText size={14} />,
    render: (ctx) => (
      <LogsTab
        droneId={ctx.droneId}
        showFlights={(ctx.drone.profile ?? "drone") === "drone"}
      />
    ),
  },
];
