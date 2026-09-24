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

/** The Agent sidebar, section by section, top -> bottom.
 *
 * A page whose `mergeInto` names a live page that THIS profile offers renders
 * as that page's Setup segment rather than a row of its own, so the subsystem
 * occupies one row. It is still named here: a profile whose live host is
 * gated away (a ground station has no air-side Link sub-page, its radio is a
 * top-level tab) still needs the configuration page, and it appears in this
 * position.
 */
export const NAV_SECTIONS: NavSectionSpec[] = [
  {
    // Was labelled "Overview" while containing neither an overview nor
    // anything the word predicts.
    key: "node",
    labelKey: "dronePanel.agentGroups.node",
    items: ["system", "battery", "battery-config", "profile"],
  },
  {
    // Radio physics. On a drone, `radio-config` merges into `radio` as its
    // Setup segment; on a ground station the live half lives at top level, so
    // the config page stands alone here.
    key: "radioLink",
    labelKey: "nodeSettings.groups.radioLink",
    items: ["radio", "radio-config"],
  },
  {
    // IP networking and how this node is found and addressed.
    key: "networking",
    labelKey: "nodeSettings.groups.networking",
    items: ["network", "wifi", "cellular", "mac-pin", "discovery", "mavlink"],
  },
  {
    // Fleet autonomy. A nine-row bucket mixing radio physics, IP networking
    // and swarm coordination defeated the sticky-header scanning the rail was
    // built for, and nobody hunting swarm settings scans a networking band.
    key: "fleet",
    labelKey: "nodeSettings.groups.fleet",
    items: ["swarm"],
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
    // `display` before the rest: on a ground station it carries the one
    // boot-critical write on this node (which renderer comes up at boot), and
    // it is gated to that profile so it is absent everywhere else.
    items: ["display", "region", "self-heal", "security", "advanced"],
  },
  {
    // Logs are a top-level surface on every profile now — "what happened on
    // this node" is a first question, not a configuration sub-page.
    key: "software",
    labelKey: "dronePanel.agentGroups.software",
    items: ["plugins"],
  },
];

/**
 * Retired sub-page id -> the live page that absorbed it. A persisted or
 * deep-linked id for a merged half resolves to its host with the Setup
 * segment preselected, so the operator lands where they asked.
 */
export const MERGED_SUBPAGE_HOSTS: Record<string, string> = {
  "radio-config": "radio",
  video: "cameras",
  "vision-perception": "vision",
  "world-model-config": "world-model",
  "battery-config": "battery",
};

/** Which pane of a (possibly merged) sub-page a requested id names. */
export interface ResolvedSubpage {
  id: string;
  segment: "live" | "setup";
}

export function resolveSubpage(requested: string): ResolvedSubpage {
  const host = MERGED_SUBPAGE_HOSTS[requested];
  return host
    ? { id: host, segment: "setup" }
    : { id: requested, segment: "live" };
}

/** The Setup half of a merged sub-page. */
export interface AgentNavSetupPane {
  /** Full i18n path for the segment's own label, used in the page header. */
  labelKey: string;
  readsConfig: boolean;
  render: () => ReactNode;
}

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
  /** Present when a configuration page merged into this live page. The page
   * then renders as a Live | Setup segmented pane rather than one body. */
  setup?: AgentNavSetupPane;
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
 *
 * A configuration page carrying `mergeInto` is attached to the named live page
 * as its Setup segment rather than becoming a row of its own — unless this
 * profile has no such live page, in which case it keeps its own row.
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
      const host = item.mergeInto ? byId.get(item.mergeInto) : undefined;
      if (host) {
        byId.set(host.id, {
          ...host,
          setup: {
            labelKey: item.labelKey,
            readsConfig: item.readsConfig,
            render: () => item.render(settingsCtx),
          },
        });
        continue;
      }
      // No live host on this profile (a ground station's live radio is a
      // TOP-LEVEL tab, not a sub-page), so the configuration page stands on
      // its own row in the position the section table gives it. Dropping it
      // would take the node's WFB configuration with it.
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
