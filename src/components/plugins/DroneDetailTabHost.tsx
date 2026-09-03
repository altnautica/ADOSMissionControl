"use client";

/**
 * @module DroneDetailTabHost
 * @description Orchestrates per-drone plugin tabs inside
 * `NodeDetailPanel.tsx`. Reads the `node.detail.tab` contributions
 * for the currently-selected drone and exposes two render surfaces:
 *
 *   - `<DroneDetailTabHeaders>`: headers-only. Mount this inside the
 *     static tablist alongside the other static-tab buttons.
 *   - `<DroneDetailTabBody>`: body-only. Mount this inside the static
 *     tabpanel switch when the active tab is a plugin tab.
 *
 * Lifecycle and capability-token wiring live in `PluginHostProvider`
 * keyed by `deviceId`. This module is the surface that sits inside
 * `DroneDetailPanel`'s tab strip, downstream of the static tabs
 * (Overview, Flights, Calibrate, Parameters, Configure, Plugins,
 * Radio).
 *
 * Behaviour contract (matches slot 13 spec at
 * `product/specs/ados-plugin-system/08-ui-extension-points.md` 3.13):
 *
 *   - Tab bodies render only when their tab is the currently active
 *     plugin tab. Inactive bodies render `null` so no iframe is
 *     mounted before its tab is clicked.
 *   - On drone switch the provider remounts, this component unmounts,
 *     and every active iframe tears down with it. The 300 ms pause
 *     grace lives in `PluginHostProvider` not here.
 *   - The host does not own the static tabs. `DroneDetailPanel`
 *     renders the static tab strip and this component sits to the
 *     right of it as an additive surface.
 *
 * @license GPL-3.0-only
 */

import { useDronePluginContributions } from "@/hooks/use-drone-plugin-contributions";
import { PluginSlot } from "@/components/plugins/PluginSlot";
import { PluginParametersPanel } from "@/components/plugins/parameters/PluginParametersPanel";
import {
  PER_DRONE_SLOTS,
  isPerDroneSlot,
  type PairedNodeProfile,
} from "@/lib/plugins/types";
import { cn } from "@/lib/utils";

/**
 * Canonical slot name this host renders: the per-node tab slot, sourced
 * from `PER_DRONE_SLOTS[0]` so the host stays honest if the per-drone
 * slot set is reordered.
 */
const NODE_DETAIL_TAB_SLOT = PER_DRONE_SLOTS[0];
if (!isPerDroneSlot(NODE_DETAIL_TAB_SLOT)) {
  // Defensive: if someone reorders PLUGIN_SLOTS so the first entry of
  // PER_DRONE_SLOTS stops satisfying the predicate, fail loud rather
  // than silently rendering against a fleet-wide slot.
  throw new Error(
    `PER_DRONE_SLOTS[0] (${NODE_DETAIL_TAB_SLOT}) is not per-drone`,
  );
}

/**
 * Stable tab-id derivation from an install row id. Keeps the
 * DroneDetailPanel switch insensitive to plugin id collisions
 * (plugin id is reverse-DNS and unique per row, but install row id
 * is the canonical primary key in `cmd_pluginInstalls`).
 */
export function pluginTabId(installId: string): string {
  return `plugin:${installId}`;
}

/** Sniff: does this active tab id come from a plugin contribution? */
export function isPluginTabId(tabId: string): boolean {
  return tabId.startsWith("plugin:");
}

interface DroneDetailTabHeadersProps {
  /** Currently-selected node's id. Drives the contribution lookup. */
  agentId: string;
  /** Active tab id from the parent panel. */
  activeTabId: string;
  /** Fired when the operator clicks a plugin tab header. */
  onSelectPluginTab: (tabId: string) => void;
  /** Resolved profile of the selected node, so a `node.detail.tab` with a
   * `profile` narrowing only surfaces on a matching profile. */
  nodeProfile?: PairedNodeProfile;
  /** Optional class on the headers strip. */
  className?: string;
}

/**
 * Headers-only render surface. Mount inside the static tablist
 * alongside the static-tab buttons. Renders zero DOM when no plugins
 * contribute, so nodes without plugin tabs pay no DOM cost.
 */
export function DroneDetailTabHeaders({
  agentId,
  activeTabId,
  onSelectPluginTab,
  nodeProfile,
  className,
}: DroneDetailTabHeadersProps) {
  const contributions = useDronePluginContributions(agentId, nodeProfile);
  if (contributions.length === 0) return null;
  return (
    <>
      {contributions.map((c) => {
        const tabId = pluginTabId(c.installId);
        const selected = activeTabId === tabId;
        return (
          <button
            key={c.installId}
            id={`drone-tab-${tabId}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`drone-tabpanel-${tabId}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelectPluginTab(tabId)}
            className={cn(
              "self-stretch flex items-center px-2.5 text-xs font-medium transition-colors cursor-pointer shrink-0 -mb-px border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
              selected
                ? "text-accent-primary border-accent-primary"
                : "text-text-secondary hover:text-text-primary border-transparent",
              className,
            )}
          >
            {c.title}
          </button>
        );
      })}
    </>
  );
}

interface DroneDetailTabBodyProps {
  agentId: string;
  /** Active tab id from the parent panel. Body renders nothing
   * unless this matches one of the plugin contribution tab ids. */
  activeTabId: string;
  /** Resolved profile of the selected node; threaded to the contribution
   * lookup so the body matches the same profile-filtered set as the headers. */
  nodeProfile?: PairedNodeProfile;
  className?: string;
}

/**
 * Body-only render surface. Mount inside the static tabpanel switch
 * when the active tab is a plugin tab. Renders the active plugin's native
 * parameter panel (its declarative `gcs.contributes.parameters`) above the
 * sandboxed iframe slot. A params-only plugin (no iframe entrypoint) renders
 * just the panel — the `<PluginSlot>` mounts nothing when the plugin ships no
 * bundle, so the panel is the whole body. Sibling contributions do not mount
 * until their tab becomes active.
 *
 * Surface dependency: the parameter panel renders ONLY here, inside a
 * `node.detail.tab` body. A plugin that declares `contributesParameters` but
 * no `node.detail.tab` has no surface for those parameters today — there is no
 * Settings → Plugins panel that mounts `PluginParametersPanel`. This is by
 * design (parameters live in the per-node tab body); a fleet-level params home
 * waits on the still-hostless slots landing. So a "params-only plugin" must
 * also declare a `node.detail.tab` to be configurable.
 */
export function DroneDetailTabBody({
  agentId,
  activeTabId,
  nodeProfile,
  className,
}: DroneDetailTabBodyProps) {
  const contributions = useDronePluginContributions(agentId, nodeProfile);
  if (contributions.length === 0) return null;

  const active = contributions.find(
    (c) => pluginTabId(c.installId) === activeTabId,
  );
  if (!active) return null;

  const tabId = pluginTabId(active.installId);
  const hasParameters = active.parameters.length > 0;
  return (
    <div
      id={`drone-tabpanel-${tabId}`}
      role="tabpanel"
      aria-labelledby={`drone-tab-${tabId}`}
      className={cn(
        "flex-1 min-h-0 overflow-y-auto flex flex-col",
        className,
      )}
    >
      {hasParameters ? (
        <div className="p-3 border-b border-border-default">
          {/* No `values` source today: the agent exposes a config write but no
              read-back, and the cloud config mirror is deferred. The panel
              seeds from schema defaults and badges each unconfirmed value as a
              default rather than presenting it as the drone's live setting.
              When a confirmed-values source lands, pass it here. */}
          <PluginParametersPanel
            droneId={agentId}
            pluginId={active.pluginId}
            parameters={active.parameters}
          />
        </div>
      ) : null}
      {/* The iframe slot mounts only when the plugin ships a GCS bundle; a
          params-only plugin leaves this empty and the panel above is the
          whole body. */}
      <PluginSlot
        name={NODE_DETAIL_TAB_SLOT}
        className={cn(
          "flex flex-col",
          // Let the iframe own the remaining space only when there is one;
          // params-only plugins shouldn't reserve a tall empty region.
          hasParameters ? "min-h-0" : "flex-1 min-h-0 overflow-hidden",
        )}
        iframeClassName="flex-1 w-full"
      />
    </div>
  );
}
