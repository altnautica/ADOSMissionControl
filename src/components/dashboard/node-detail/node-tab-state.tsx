"use client";

/**
 * @module node-detail/node-tab-state
 * @description Which tab the node-detail panel shows, and the side effects
 * that hang off that choice.
 *
 * `useNodeTab` owns the requested tab: seeded from the node's remembered tab
 * and RESEEDED on a node switch (the panel is not remounted per node), and fed
 * by a pending Cmd+K / deep-link tab. `resolveNodeTab` turns the request into
 * the tab the node can actually show. The three components commit the effects
 * that need the RESOLVED tab, which is only known after the panel's `!drone`
 * guard, so they are mounted children rather than hooks in the panel body.
 * @license GPL-3.0-only
 */

import { useEffect, useRef, useState } from "react";
import { useUiPrefsStore } from "@/stores/ui-prefs-store";
import { useUiStore } from "@/stores/ui-store";
import { isPluginTabId } from "@/components/plugins/DroneDetailTabHost";
import { agentRedirect, topLevelAlias } from "./agent/agent-redirect";

/**
 * The requested tab for `droneId`. A lazy initializer alone would carry node
 * A's tab onto node B, and the persist effect would then write it into B's
 * record, so the seed is re-applied whenever the node changes.
 */
export function useNodeTab(droneId: string): [string, (tab: string) => void] {
  const [activeTab, setActiveTab] = useState(
    () => useUiPrefsStore.getState().getLastTab(droneId) ?? "overview",
  );
  const seededForNode = useRef(droneId);
  if (seededForNode.current !== droneId) {
    seededForNode.current = droneId;
    setActiveTab(useUiPrefsStore.getState().getLastTab(droneId) ?? "overview");
  }

  // Consume a pending detail tab from Cmd+K navigation or a deep-link hand-off.
  const pendingDetailTab = useUiStore((s) => s.pendingDetailTab);
  const setPendingDetailTab = useUiStore((s) => s.setPendingDetailTab);
  useEffect(() => {
    if (pendingDetailTab) {
      setActiveTab(pendingDetailTab);
      setPendingDetailTab(null);
    }
  }, [pendingDetailTab, setPendingDetailTab]);

  return [activeTab, setActiveTab];
}

export interface ResolvedNodeTab {
  /** The Agent sub-page a nested id redirects to, or null. */
  agentSubpage: string | null;
  /** The tab id after alias + Agent redirect. */
  requestedTab: string;
  /** Whether the node can show `requestedTab`. False falls back to the first
   * surface and stops the tab memory from persisting the request. */
  resolved: boolean;
  /** The tab actually rendered. */
  visibleTab: string;
}

/**
 * Resolve the requested tab against what this node offers.
 *
 * Two migrations, in order. A retired id whose surface merged into a sibling
 * still at top level resolves to the survivor FIRST, so it is not pushed into
 * the Agent page. What remains is the set that genuinely moved inside the
 * Agent page; `agentRedirect` guards on `surfaceIds` so a profile that still
 * owns an id at top level keeps it.
 *
 * A plugin tab resolves only while its contribution is present: tab ids are
 * `plugin:<installId>`, so an uninstalled or reinstalled plugin leaves a dead
 * id that must fall back rather than render an empty body.
 */
export function resolveNodeTab(
  activeTab: string,
  surfaceIds: readonly string[],
  pluginIds: readonly string[],
): ResolvedNodeTab {
  const aliasedTab = topLevelAlias(activeTab, [...surfaceIds]);
  const agentSubpage = agentRedirect(aliasedTab, [...surfaceIds]);
  const requestedTab = agentSubpage ? "agent" : aliasedTab;
  const resolved = isPluginTabId(requestedTab)
    ? pluginIds.includes(requestedTab)
    : surfaceIds.includes(requestedTab);
  return {
    agentSubpage,
    requestedTab,
    resolved,
    visibleTab: resolved ? requestedTab : (surfaceIds[0] ?? "overview"),
  };
}

/**
 * Commits the one side effect of the Agent deep-link redirect: handing the
 * sub-page to the Agent page. Mounting it only when the redirect fires keeps
 * `agentRedirect` the single decision point and runs the handoff once.
 */
export function AgentSubpageHandoff({ subpage }: { subpage: string }) {
  useEffect(() => {
    useUiStore.getState().setPendingAgentPanel(subpage);
  }, [subpage]);
  return null;
}

/**
 * Persists the node's tab, and scrolls it into view in the overflowing strip.
 *
 * `resolved` is false when the node could not offer the requested tab and the
 * panel fell back to the first surface. Persisting in that case would destroy
 * the operator's remembered position the moment a capability blipped (or the
 * first time they opened a node whose remembered tab had not re-appeared yet).
 */
export function TabMemory({
  droneId,
  visibleTab,
  requestedTab,
  resolved,
}: {
  droneId: string;
  visibleTab: string;
  requestedTab: string;
  resolved: boolean;
}) {
  useEffect(() => {
    if (!resolved) return;
    useUiPrefsStore.getState().setLastTab(droneId, requestedTab);
  }, [droneId, requestedTab, resolved]);
  useEffect(() => {
    // The strip hides its scrollbar, so a restored tab off the left edge reads
    // as "the panel is showing the wrong content" with no hint more exists.
    document
      .getElementById(`drone-tab-${visibleTab}`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [visibleTab]);
  return null;
}

/**
 * Leaves immersive mode when the resolved surface is not the cockpit. Keyed on
 * the resolved tab: switching from a drone parked on Cockpit to a workstation
 * leaves the request at `cockpit` while the panel renders the workstation
 * Overview, and gating on the request left the operator full-bleed on a
 * surface with no chrome and no way back.
 */
export function ImmersiveGuard({ visibleTab }: { visibleTab: string }) {
  const immersiveMode = useUiStore((s) => s.immersiveMode);
  const exitImmersiveMode = useUiStore((s) => s.exitImmersiveMode);
  useEffect(() => {
    if (immersiveMode && visibleTab !== "cockpit") exitImmersiveMode();
  }, [visibleTab, immersiveMode, exitImmersiveMode]);
  return null;
}
