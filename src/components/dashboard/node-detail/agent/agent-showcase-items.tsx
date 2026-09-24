/**
 * @module node-detail/agent/agent-showcase-items
 * @description The capability cards for the Agent page empty state (a drone with
 * no companion computer paired). Each card names one thing the ADOS Drone Agent
 * adds once an onboard computer is paired. Icon + i18n key stem only; the copy
 * lives in the locale files under dronePanel.agentShowcase.cards.<key>.
 * @license GPL-3.0-only
 */
// Exempt from 300 LOC soft rule: card data file.

import {
  Activity,
  Cloud,
  Eye,
  Gamepad2,
  Puzzle,
  RadioTower,
  ScrollText,
  Video,
  type LucideIcon,
} from "lucide-react";

export interface AgentShowcaseItem {
  /** i18n key stem under dronePanel.agentShowcase.cards.<key>.{title,desc}. */
  key: string;
  icon: LucideIcon;
}

export const AGENT_SHOWCASE_ITEMS: AgentShowcaseItem[] = [
  { key: "liveVideo", icon: Video },
  { key: "flightControl", icon: Gamepad2 },
  { key: "perception", icon: Eye },
  { key: "radioLink", icon: RadioTower },
  { key: "fleetCloud", icon: Cloud },
  { key: "extensions", icon: Puzzle },
  { key: "blackBox", icon: ScrollText },
  { key: "health", icon: Activity },
];
