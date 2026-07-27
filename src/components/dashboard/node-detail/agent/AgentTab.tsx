"use client";

/**
 * @module node-detail/agent/AgentTab
 * @description The Agent page: a two-pane surface (a sectioned secondary sidebar
 * + the active sub-page) that collapses the companion-computer surfaces behind
 * one node-detail tab. For a drone with no companion paired it renders the
 * onboarding showcase instead of the sidebar. The active sub-page is remembered
 * per node and can be deep-linked via the panel's pendingAgentPanel handoff.
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useUiStore } from "@/stores/ui-store";
import { useUiPrefsStore } from "@/stores/ui-prefs-store";
import type { SurfaceContext } from "../surface-types";
import { NodeSubNav, type SubNavSection } from "./NodeSubNav";
import { AgentShowcase } from "./AgentShowcase";
import {
  AGENT_NAV_ITEMS,
  AGENT_SECTIONS,
  type AgentSectionKey,
} from "./agent-nav-items";

const DEFAULT_PANEL = "system";
const SECTION_ORDER: AgentSectionKey[] = ["system", "perception", "software"];

export function AgentTab({ ctx }: { ctx: SurfaceContext }) {
  const tRoot = useTranslations();
  const pendingAgentPanel = useUiStore((s) => s.pendingAgentPanel);
  const setPendingAgentPanel = useUiStore((s) => s.setPendingAgentPanel);

  const [active, setActive] = useState(
    () =>
      useUiPrefsStore.getState().getLastAgentPanel(ctx.droneId) ?? DEFAULT_PANEL,
  );

  const visible = useMemo(
    () => AGENT_NAV_ITEMS.filter((i) => (i.when ? i.when(ctx) : true)),
    [ctx],
  );
  const visibleIds = visible.map((i) => i.id);
  const activeId = visibleIds.includes(active)
    ? active
    : (visibleIds[0] ?? DEFAULT_PANEL);

  // Consume a deep-link handoff (a persisted or Cmd+K jump to a now-nested id).
  useEffect(() => {
    if (pendingAgentPanel) {
      setActive(pendingAgentPanel);
      setPendingAgentPanel(null);
    }
  }, [pendingAgentPanel, setPendingAgentPanel]);

  // Remember the last sub-page per node so re-opening the Agent page returns to it.
  useEffect(() => {
    useUiPrefsStore.getState().setLastAgentPanel(ctx.droneId, activeId);
  }, [ctx.droneId, activeId]);

  const sections: SubNavSection[] = useMemo(
    () =>
      SECTION_ORDER.map((key) => ({
        key,
        label: tRoot(AGENT_SECTIONS[key]),
        items: visible
          .filter((i) => i.section === key)
          .map((i) => ({ id: i.id, label: tRoot(i.labelKey), icon: i.icon })),
      })).filter((s) => s.items.length > 0),
    [visible, tRoot],
  );

  // A drone with no companion the GCS can reach: sell what an onboard computer
  // unlocks rather than showing a near-empty page. A drone reached through its
  // ground station's relay-proxy DOES have one, and every sub-page below reads
  // it over that lane, so it must not land here.
  const noCompanion =
    (ctx.drone.profile ?? "drone") === "drone" &&
    ctx.agentDeviceId === null &&
    ctx.relayReach === null;
  if (noCompanion) {
    return <AgentShowcase droneId={ctx.droneId} />;
  }

  const activeItem = visible.find((i) => i.id === activeId);

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <NodeSubNav
        title={tRoot("dronePanel.agent")}
        sections={sections}
        activeId={activeId}
        onSelect={setActive}
      />
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
        {activeItem?.render(ctx)}
      </div>
    </div>
  );
}
