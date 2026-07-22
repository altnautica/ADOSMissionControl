"use client";

/**
 * @module command/nodes-view/FlightModeCell
 * @description The flight-mode control: the node's current mode, and a menu
 * that changes it.
 *
 * Mode is not a read-only label on this board — changing it is one of the two
 * things an operator most often needs across a fleet, so the readout is the
 * trigger for the mode menu. Return-to-launch and land sit in the same menu as
 * one-tap actions because that is where an operator looks for them under
 * pressure, and both go through their own skills, so both keep their typed
 * confirmations.
 *
 * A preset the node's firmware does not offer, an unreachable node, and a node
 * whose flight state is not being read all render as disabled options carrying
 * the reason, never as options that silently do nothing.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { safeTranslate } from "@/hooks/use-skill-toast-bridge";
import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ModeReadout } from "./StateCells";
import type { ReadingFreshness } from "./cell-primitives";
import {
  BOARD_MODE_SKILLS,
  type NodeSkills,
  type NodeSkillAction,
} from "./use-node-skills";

/** The mode presets, then the two one-tap recoveries. */
const MENU_SKILL_IDS: readonly string[] = [...BOARD_MODE_SKILLS, "rth", "land"];

/** Where the divider sits: after the presets, before the recoveries. */
const DIVIDER_AFTER = BOARD_MODE_SKILLS.length - 1;

export function FlightModeCell({
  telemetry,
  freshness,
  skills,
  nodeName,
}: {
  telemetry: CommandAgentSummary["telemetry"];
  freshness: ReadingFreshness;
  skills: NodeSkills;
  nodeName: string;
}) {
  const t = useTranslations();
  const tNodes = useTranslations("nodesView");

  const actions = MENU_SKILL_IDS.map((id) => skills.resolve(id)).filter(
    (action): action is NodeSkillAction => action !== null,
  );

  const items = actions.flatMap((action, index) => {
    const entry = {
      id: action.id,
      label: skillDisplayLabel(action.skill, t),
      disabled: action.disabled,
      danger: action.id === "land",
      title: action.reasonKey
        ? safeTranslate(t, action.reasonKey)
        : undefined,
    };
    return index === DIVIDER_AFTER
      ? [entry, { id: `${action.id}-divider`, label: "", divider: true }]
      : [entry];
  });

  const byId = new Map(actions.map((action) => [action.id, action]));

  return (
    <DropdownMenu
      align="left"
      items={items}
      onSelect={(id) => byId.get(id)?.run()}
      trigger={
        <button
          type="button"
          aria-label={tNodes("mode.change", { name: nodeName })}
          className={cn(
            "flex items-center gap-1 rounded border border-transparent px-1 py-0.5",
            "hover:border-border-default hover:bg-bg-tertiary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary",
          )}
        >
          <ModeReadout telemetry={telemetry} freshness={freshness} />
          <ChevronDown size={11} className="text-text-tertiary" />
        </button>
      }
    />
  );
}
