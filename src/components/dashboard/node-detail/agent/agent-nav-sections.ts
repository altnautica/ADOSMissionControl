/**
 * @module node-detail/agent/agent-nav-sections
 * @description The Agent page's ONE sidebar: the merged section table over both
 * sub-page registries — the live companion surfaces (`agent-nav-items`) and the
 * node configuration pages (`command/settings/settings-nav`) — plus the resolver
 * that turns a node's context into the ordered, gated sidebar.
 *
 * The Agent page used to nest a third sidebar inside its second one: the
 * `settings` sub-page was itself a two-pane surface with its own grouped nav, so
 * reaching one subsystem meant navigating two trees. There is now exactly one
 * nav, and a live surface sits beside the configuration for the same subsystem:
 * the Link page above the Radio config, the World Model viewer above its Atlas
 * setup, Cameras above Video.
 *
 * Sidebar order lives here and nowhere else. Each section names its sub-page ids
 * top -> bottom, and a registry entry carries only what its page *is* (label,
 * icon, gate, body). Adding a page means adding it to one registry and naming
 * its id in exactly one section — an id in neither place, or in both, is a bug
 * the section-table test fails on.
 * @license GPL-3.0-only
 */

import type { ReactNode } from "react";
import {
  SETTINGS_NAV_ITEMS,
  type SettingsPageContext,
} from "@/components/command/settings/settings-nav";
import type { SurfaceContext } from "../surface-types";
import { AGENT_NAV_ITEMS, companionPresent } from "./agent-nav-items";

export interface NavSectionSpec {
  key: string;
  /** Full i18n path for the section header. The four shared with the retired
   * Settings sidebar reuse its keys rather than minting duplicate copy. */
  labelKey: string;
  /** Sub-page ids, top -> bottom, from either registry. An id whose gate hides
   * it on this node is skipped; a section left with nothing is not rendered. */
  items: string[];
}

/** The Agent sidebar, section by section, top -> bottom. */
export const NAV_SECTIONS: NavSectionSpec[] = [
  {
    key: "overview",
    labelKey: "dronePanel.agentGroups.overview",
    items: ["system", "profile"],
  },
  {
    key: "network",
    labelKey: "nodeSettings.groups.network",
    items: [
      "radio",
      "radio-config",
      "network",
      "wifi",
      "cellular",
      "mac-pin",
      "discovery",
      "mavlink",
      "swarm",
    ],
  },
  {
    key: "videoVision",
    labelKey: "nodeSettings.groups.videoVision",
    items: [
      "cameras",
      "video",
      "vision",
      "vision-perception",
      "world-model",
      "world-model-config",
      "live-world",
    ],
  },
  {
    key: "cloud",
    labelKey: "nodeSettings.groups.cloud",
    items: ["cloud"],
  },
  {
    key: "system",
    labelKey: "nodeSettings.groups.system",
    items: ["region", "self-heal", "security", "advanced"],
  },
  {
    key: "software",
    labelKey: "dronePanel.agentGroups.software",
    items: ["plugins", "logs"],
  },
];

/** One resolved sidebar entry: a sub-page this node actually offers. */
export interface AgentNavEntry {
  id: string;
  /** Full i18n path for the sidebar label. */
  labelKey: string;
  icon: ReactNode;
  /** A configuration page renders inside the config chrome (the scrolling
   * pane, the subtitle, the per-node draft reset); a live surface owns its own
   * full-height layout. */
  isConfigPage: boolean;
  /** Whether this page reads the node configuration — the one condition under
   * which the config loading / read-only / read-failure banners are true. A
   * live surface never does, and neither do the two config pages that talk to
   * their own agent endpoints (Wi-Fi, Operating region). */
  readsConfig: boolean;
  render: () => ReactNode;
}

export interface ResolvedAgentNav {
  /** Non-empty sections, in `NAV_SECTIONS` order. */
  sections: { key: string; labelKey: string; items: AgentNavEntry[] }[];
  /** Every visible entry, flattened in sidebar order. */
  entries: AgentNavEntry[];
}

/**
 * The sidebar for one node: both registries filtered through their own gates,
 * then placed into the section table.
 *
 * The configuration half inherits the gate the retired `settings` sub-page
 * carried (`companionPresent`) on top of each page's own gate, so an FC-only
 * node with no reachable agent is offered no config pages — exactly the set it
 * could reach before the flattening, no more and no less.
 */
export function resolveAgentNav(
  ctx: SurfaceContext,
  settingsCtx: SettingsPageContext,
): ResolvedAgentNav {
  const byId = new Map<string, AgentNavEntry>();

  for (const item of AGENT_NAV_ITEMS) {
    if (item.when && !item.when(ctx)) continue;
    byId.set(item.id, {
      id: item.id,
      labelKey: item.labelKey,
      icon: item.icon,
      isConfigPage: false,
      readsConfig: false,
      render: () => item.render(ctx),
    });
  }

  if (companionPresent(ctx)) {
    for (const item of SETTINGS_NAV_ITEMS) {
      if (item.when && !item.when(settingsCtx)) continue;
      byId.set(item.id, {
        id: item.id,
        labelKey: item.labelKey,
        icon: item.icon,
        isConfigPage: true,
        readsConfig: item.readsConfig,
        render: () => item.render(settingsCtx),
      });
    }
  }

  const sections = NAV_SECTIONS.map((section) => ({
    key: section.key,
    labelKey: section.labelKey,
    items: section.items
      .map((id) => byId.get(id))
      .filter((entry): entry is AgentNavEntry => entry !== undefined),
  })).filter((section) => section.items.length > 0);

  return { sections, entries: sections.flatMap((section) => section.items) };
}
