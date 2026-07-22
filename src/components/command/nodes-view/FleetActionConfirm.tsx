"use client";

/**
 * @module command/nodes-view/FleetActionConfirm
 * @description The confirmation for sending the whole fleet home.
 *
 * A fleet-wide command is the widest-blast-radius control on this board, so the
 * dialog states the real number before the operator commits: how many nodes can
 * take the command right now out of how many exist. Sending "everything" home
 * when only three of eleven nodes can hear it is a materially different act, and
 * the operator has to know which one they are performing.
 *
 * It reuses the skill's own typed phrase — a fleet-wide return is not an
 * occasion to ask for a weaker confirmation than a single vehicle gets — and
 * refuses outright when nothing can take the command, rather than opening a
 * dialog whose confirm would do nothing.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { useSkillRegistry, buildSkillContextForNode } from "@/lib/skills";
import type { NodeCommandSinkOptions } from "@/lib/nodes/command-sink";
import { describeNodeReach } from "@/lib/nodes/node-reach";
import type { NodeRowModel } from "@/lib/nodes/node-rows";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { resolveBoardSkillState } from "./use-node-skills";

const RETURN_SKILL_ID = "rth";

export function FleetActionConfirm({
  rows,
  laneOptions,
  onRun,
  onDone,
}: {
  rows: readonly NodeRowModel[];
  laneOptions: NodeCommandSinkOptions;
  onRun: (targets: NodeRowModel[]) => void;
  onDone: () => void;
}) {
  const t = useTranslations();
  const tNodes = useTranslations("nodesView");
  const skill = useSkillRegistry((s) => s.skills).get(RETURN_SKILL_ID);

  const targets = useMemo(() => {
    if (!skill) return [];
    return rows.filter((row) => {
      const reach = describeNodeReach(row.node, laneOptions);
      const ctx = buildSkillContextForNode(row.node, laneOptions);
      return resolveBoardSkillState(skill, ctx, reach).kind !== "disabled";
    });
  }, [skill, rows, laneOptions]);

  if (!skill) return null;

  const action = skillDisplayLabel(skill, t);

  // Nothing can take the command: say so instead of offering a confirm whose
  // press would be a no-op.
  if (targets.length === 0) {
    return (
      <ConfirmDialog
        open
        variant="primary"
        title={tNodes("fleet.returnAll")}
        message={tNodes("fleet.noneReady")}
        confirmLabel={tNodes("fleet.dismiss")}
        onConfirm={onDone}
        onCancel={onDone}
      />
    );
  }

  return (
    <ConfirmDialog
      open
      variant={skill.confirm?.variant ?? "danger"}
      typedPhrase={skill.confirm?.typedPhrase}
      title={tNodes("fleet.confirmTitle", { action })}
      message={tNodes("fleet.confirmMessage", {
        action,
        ready: targets.length,
        total: rows.length,
      })}
      confirmLabel={action}
      onConfirm={() => {
        onRun([...targets]);
        onDone();
      }}
      onCancel={onDone}
    />
  );
}
