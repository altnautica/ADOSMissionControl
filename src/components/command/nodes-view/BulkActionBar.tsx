"use client";

/**
 * @module command/nodes-view/BulkActionBar
 * @description Applies one change across the selected nodes.
 *
 * A bulk flight command is a safety surface, so this bar does two things
 * differently from a row control. It resolves the action against every selected
 * node FIRST and says how many of them can actually take it, so an operator
 * never presses "return to launch" over seven nodes believing all seven are
 * going home. And it takes one confirmation for the whole batch, carrying the
 * skill's own typed phrase and the real count — the confirm seam holds a single
 * pending request, so per-node dialogs would cancel one another and leave most
 * of the batch silently unsent.
 *
 * Arming is deliberately not offered in bulk. It is the one action whose blast
 * radius grows with the selection rather than shrinking it, and it stays a
 * per-node decision in the row menu.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { useSkillRegistry, type Skill } from "@/lib/skills";
import type { NodeCommandSinkOptions } from "@/lib/nodes/command-sink";
import { describeNodeReach } from "@/lib/nodes/node-reach";
import { buildSkillContextForNode } from "@/lib/skills";
import type { NodeRowModel } from "@/lib/nodes/node-rows";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  BOARD_MODE_SKILLS,
  dispatchSkillForNodes,
  resolveBoardSkillState,
} from "./use-node-skills";

/** Mode presets, then the two recoveries — the same set a row offers. */
const BULK_SKILL_IDS: readonly string[] = [...BOARD_MODE_SKILLS, "rth", "land"];

/** The nodes in `rows` that can actually take `skill` right now. */
function readyNodes(
  skill: Skill,
  rows: readonly NodeRowModel[],
  options: NodeCommandSinkOptions,
): NodeRowModel[] {
  return rows.filter((row) => {
    const reach = describeNodeReach(row.node, options);
    const ctx = buildSkillContextForNode(row.node, options);
    return resolveBoardSkillState(skill, ctx, reach).kind !== "disabled";
  });
}

export function BulkActionBar({
  selectedRows,
  laneOptions,
  onClear,
}: {
  selectedRows: NodeRowModel[];
  laneOptions: NodeCommandSinkOptions;
  onClear: () => void;
}) {
  const t = useTranslations();
  const tNodes = useTranslations("nodesView");
  const skills = useSkillRegistry((s) => s.skills);
  const [pending, setPending] = useState<{
    skill: Skill;
    targets: NodeRowModel[];
  } | null>(null);

  if (selectedRows.length === 0) return null;

  const options = BULK_SKILL_IDS.flatMap((id) => {
    const skill = skills.get(id);
    if (!skill) return [];
    const ready = readyNodes(skill, selectedRows, laneOptions);
    return [
      {
        id,
        label: tNodes("bulk.option", {
          action: skillDisplayLabel(skill, t),
          ready: ready.length,
          total: selectedRows.length,
        }),
        disabled: ready.length === 0,
        title: ready.length === 0 ? tNodes("bulk.noneReady") : undefined,
      },
    ];
  });

  function begin(skillId: string) {
    const skill = skills.get(skillId);
    if (!skill) return;
    const targets = readyNodes(skill, selectedRows, laneOptions);
    if (targets.length === 0) return;
    setPending({ skill, targets });
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2">
        <span className="text-xs font-medium text-text-primary">
          {tNodes("bulk.selected", { count: selectedRows.length })}
        </span>

        <DropdownMenu
          align="left"
          items={options}
          onSelect={begin}
          trigger={
            <button
              type="button"
              className="rounded border border-border-default bg-bg-secondary px-2 py-1 text-xs text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
            >
              {tNodes("bulk.flightAction")}
            </button>
          }
        />

        <button
          type="button"
          onClick={onClear}
          aria-label={tNodes("bulk.clear")}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-xs text-text-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        >
          <X size={12} />
          {tNodes("bulk.clear")}
        </button>
      </div>

      {pending && (
        <ConfirmDialog
          open
          variant={pending.skill.confirm?.variant ?? "danger"}
          // The batch carries the same typed phrase a single vehicle would ask
          // for; applying it to many nodes is not a reason to ask for less.
          typedPhrase={pending.skill.confirm?.typedPhrase}
          title={tNodes("bulk.confirmTitle", {
            action: skillDisplayLabel(pending.skill, t),
          })}
          message={tNodes("bulk.confirmMessage", {
            action: skillDisplayLabel(pending.skill, t),
            count: pending.targets.length,
            names: pending.targets
              .slice(0, 5)
              .map((row) => row.node.name)
              .join(", "),
          })}
          confirmLabel={skillDisplayLabel(pending.skill, t)}
          onConfirm={() => {
            const { skill, targets } = pending;
            setPending(null);
            void dispatchSkillForNodes(
              skill.id,
              targets.map((row) => row.node),
              laneOptions,
            );
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
