"use client";

/**
 * @module command/nodes-view/NodeActionsMenu
 * @description The per-row action menu: the flight actions, the ways into a
 * node's own surfaces, and unpairing.
 *
 * The sidebar's context menu is not reused. It carries recognition and
 * organisation actions (colour, initials, pinning) and deliberately carries no
 * flight actions, and adding them there would put arm and land one right-click
 * away from every node in the sidebar. This menu is the board's own, scoped to
 * operating a node.
 *
 * The flight actions run through their skills, so arm and land keep their typed
 * confirmations. Unpair keeps its own confirmation because forgetting a node is
 * not a flight action and has no skill.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { MoreHorizontal } from "lucide-react";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { safeTranslate } from "@/hooks/use-skill-toast-bridge";
import { useForgetNode } from "@/hooks/use-forget-node";
import { useUiStore } from "@/stores/ui-store";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  BOARD_ACTION_SKILLS,
  type NodeSkillAction,
  type NodeSkills,
} from "./use-node-skills";

/** Navigation entries, each a node-detail destination. */
const NAV_ITEMS = [
  { id: "open-cockpit", tab: "cockpit", panel: null },
  { id: "configure", tab: "agent", panel: "settings" },
  { id: "view-logs", tab: "agent", panel: "logs" },
] as const;

export function NodeActionsMenu({
  node,
  skills,
  onOpen,
}: {
  node: FleetNodeEntry;
  skills: NodeSkills;
  onOpen: (node: FleetNodeEntry) => void;
}) {
  const t = useTranslations();
  const tNodes = useTranslations("nodesView");
  const [confirmingUnpair, setConfirmingUnpair] = useState(false);
  const forget = useForgetNode();

  const flightActions = BOARD_ACTION_SKILLS.map((id) =>
    skills.resolve(id),
  ).filter((action): action is NodeSkillAction => action !== null);

  function navigate(tab: string, panel: string | null) {
    const ui = useUiStore.getState();
    ui.setPendingDetailTab(tab);
    ui.setPendingAgentPanel(panel);
    onOpen(node);
  }

  const items = [
    ...flightActions.map((action) => ({
      id: action.id,
      label: skillDisplayLabel(action.skill, t),
      disabled: action.disabled,
      danger: action.id === "arm" || action.id === "land",
      title: action.reasonKey ? safeTranslate(t, action.reasonKey) : undefined,
    })),
    { id: "nav-divider", label: "", divider: true },
    ...NAV_ITEMS.map((item) => ({
      id: item.id,
      label: tNodes(`actions.${item.id}`),
    })),
    { id: "lifecycle-divider", label: "", divider: true },
    {
      id: "unpair",
      label: tNodes("actions.unpair"),
      danger: true,
    },
  ];

  const flightById = new Map(
    flightActions.map((action) => [action.id, action]),
  );

  function onSelect(id: string) {
    const flight = flightById.get(id);
    if (flight) {
      flight.run();
      return;
    }
    const nav = NAV_ITEMS.find((item) => item.id === id);
    if (nav) {
      navigate(nav.tab, nav.panel);
      return;
    }
    if (id === "unpair") setConfirmingUnpair(true);
  }

  return (
    <>
      <DropdownMenu
        align="right"
        items={items}
        onSelect={onSelect}
        trigger={
          <button
            type="button"
            aria-label={tNodes("actions.menuLabel", { name: node.name })}
            className="rounded p-1 text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <MoreHorizontal size={14} />
          </button>
        }
      />
      {confirmingUnpair && (
        <ConfirmDialog
          open
          title={tNodes("unpair.title")}
          message={tNodes("unpair.message", { name: node.name })}
          confirmLabel={tNodes("actions.unpair")}
          variant="danger"
          onConfirm={() => {
            setConfirmingUnpair(false);
            forget(node._id, { convexId: node.convexId ?? null });
          }}
          onCancel={() => setConfirmingUnpair(false)}
        />
      )}
    </>
  );
}
