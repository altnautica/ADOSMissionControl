"use client";

/**
 * @module use-node-plugin-pages
 * @description The plugin-contributed Agent-sidebar pages (`node.agent.page`)
 * and top-level node surfaces (`node.surface`) for one node, projected from
 * the same live install rows the node-detail tab headers read
 * (`useLiveInstallRows`) and narrowed to the node's profile. Each entry's
 * `render` mounts the loaded contribution through `PluginPageMount`.
 *
 * In demo mode the rows come from `getDemoNodePageInstallRows`.
 * @license GPL-3.0-only
 */

import { createElement, useMemo } from "react";
import { isDemoMode } from "@/lib/utils";
import { resolveNamedIcon } from "@/lib/icons/icon-registry";
import {
  slotOffersOnProfile,
  type NodeSurfaceGroup,
  type PairedNodeProfile,
} from "@/lib/plugins/types";
import {
  useLiveInstallRows,
  type InstallDetailRow,
} from "@/hooks/use-drone-plugin-contributions";
import { getDemoNodePageInstallRows } from "@/mock/mock-plugins";
import {
  pluginPageId,
  type AgentNavContribution,
  type ProfileSurfaceContribution,
} from "@/components/dashboard/node-detail/surface-types";
import {
  COMPUTE_GROUP,
  DEVICE_GROUP,
  LINK_GROUP,
  STATUS_GROUP,
  VEHICLE_GROUP,
} from "@/components/dashboard/node-detail/surface-groups";
import { PLUGIN_PAGE_LABEL_KEY } from "@/components/dashboard/node-detail/agent/plugin-nav";
import { PluginPageMount } from "@/components/dashboard/node-detail/PluginPageMount";

/** Sort hint for a page whose manifest gives none (the slot-wide default). */
const DEFAULT_ORDER = 60;

/** The manifest band name -> the tab-strip group key it renders under. */
const GROUP_KEY: Record<NodeSurfaceGroup, string> = {
  status: STATUS_GROUP,
  vehicle: VEHICLE_GROUP,
  link: LINK_GROUP,
  device: DEVICE_GROUP,
  compute: COMPUTE_GROUP,
};

export interface NodePluginPages {
  agentPages: ReadonlyArray<AgentNavContribution>;
  surfaces: ReadonlyArray<ProfileSurfaceContribution>;
}

const EMPTY: NodePluginPages = Object.freeze({ agentPages: [], surfaces: [] });

/**
 * Project live install rows into the pages and surfaces a node of
 * `nodeProfile` offers. An Agent page with no `profile` is offered on every
 * profile; a node surface must name its profiles and is dropped otherwise.
 */
export function projectNodePluginPages(
  rows: ReadonlyArray<InstallDetailRow>,
  nodeProfile: PairedNodeProfile | undefined,
): NodePluginPages {
  const agentPages: AgentNavContribution[] = [];
  const surfaces: ProfileSurfaceContribution[] = [];
  for (const row of rows) {
    for (const entry of row.gcsContributes) {
      if (!slotOffersOnProfile(entry.slot, entry.profile, nodeProfile)) continue;
      const id = pluginPageId(row.pluginId, entry.panelId);
      const label = entry.title ?? row.name;
      const order = entry.order ?? DEFAULT_ORDER;
      if (entry.slot === "node.agent.page") {
        agentPages.push({
          id,
          pluginId: row.pluginId,
          installId: row.installId,
          panelId: entry.panelId,
          label,
          icon: createElement(resolveNamedIcon(entry.icon), { size: 14 }),
          section: entry.section ?? "software",
          ...(entry.after ? { after: entry.after } : {}),
          order,
          ...(entry.setupFor ? { setupFor: entry.setupFor } : {}),
          render: () =>
            createElement(PluginPageMount, {
              slot: "node.agent.page",
              installId: row.installId,
              panelId: entry.panelId,
            }),
        });
      } else if (entry.slot === "node.surface" && entry.profile && entry.profile.length > 0) {
        surfaces.push({
          spec: {
            id,
            labelKey: PLUGIN_PAGE_LABEL_KEY,
            label,
            render: () =>
              createElement(PluginPageMount, {
                slot: "node.surface",
                installId: row.installId,
                panelId: entry.panelId,
              }),
          },
          profile: entry.profile,
          ...(entry.group ? { group: GROUP_KEY[entry.group] } : {}),
          order,
        });
      }
    }
  }
  return { agentPages, surfaces };
}

/**
 * The plugin Agent pages and node surfaces for one node. Stable identity
 * while the install rows and the profile are unchanged.
 */
export function useNodePluginPages(
  bareDeviceId: string | undefined,
  nodeProfile: PairedNodeProfile | undefined,
): NodePluginPages {
  const rows = useLiveInstallRows(bareDeviceId);
  return useMemo(() => {
    if (!bareDeviceId) return EMPTY;
    const source = isDemoMode() ? getDemoNodePageInstallRows() : rows;
    return source ? projectNodePluginPages(source, nodeProfile) : EMPTY;
  }, [bareDeviceId, rows, nodeProfile]);
}
