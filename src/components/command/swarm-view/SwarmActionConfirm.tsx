"use client";

/**
 * @module command/swarm-view/SwarmActionConfirm
 * @description The last gate before a fleet-wide change commits.
 *
 * Both dialogs state the real number first: how many of the selected slots can
 * actually take the change, out of how many were selected. "Return eighteen
 * drones to launch" when only four can hear the command is a materially
 * different act, and the operator has to know which one they are performing
 * before they press, not after.
 *
 * The typed phrase is not softened for a batch. A flight action carries the
 * skill's own phrase — the one a single vehicle would ask for — because
 * applying it to twenty-four aircraft is not a reason to ask for less. A
 * formation change carries the formation's own name, but only when the target
 * is literally the whole fleet; a partial selection is an ordinary reversible
 * config write and gating it that hard would just teach the operator to type
 * without reading.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import { skillDisplayLabel } from "@/lib/skills/skill-label";
import type { Skill } from "@/lib/skills";
import type { NodeRowModel } from "@/lib/nodes/node-rows";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { SwarmFormation } from "@/lib/swarm/config-keys";

export function SwarmSkillConfirm({
  skill,
  targets,
  selectedCount,
  onRun,
  onCancel,
}: {
  skill: Skill;
  /** The rows that passed the gate stack — the "N" the dialog states. */
  targets: readonly NodeRowModel[];
  selectedCount: number;
  onRun: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations();
  const tSwarm = useTranslations("swarmView");
  const action = skillDisplayLabel(skill, t);

  return (
    <ConfirmDialog
      open
      variant={skill.confirm?.variant ?? "danger"}
      typedPhrase={skill.confirm?.typedPhrase}
      title={tSwarm("bulk.confirmTitle", { action })}
      message={tSwarm("bulk.confirmMessage", {
        action,
        ready: targets.length,
        total: selectedCount,
      })}
      confirmLabel={action}
      onConfirm={onRun}
      onCancel={onCancel}
    />
  );
}

export function SwarmFormationConfirm({
  formation,
  targets,
  selectedCount,
  nameByDeviceId,
  /** True when the selection is every slot on the board. */
  broadcast,
  onRun,
  onCancel,
}: {
  formation: SwarmFormation;
  /** Device ids a config transport reaches — the "N" the dialog states. */
  targets: readonly string[];
  selectedCount: number;
  nameByDeviceId: ReadonlyMap<string, string>;
  broadcast: boolean;
  onRun: () => void;
  onCancel: () => void;
}) {
  const tSwarm = useTranslations("swarmView");
  const label = tSwarm(`formation.${formation}`);

  return (
    <ConfirmDialog
      open
      variant={broadcast ? "danger" : "primary"}
      typedPhrase={broadcast ? formation : undefined}
      title={tSwarm("bulk.formationConfirmTitle", { formation: label })}
      message={tSwarm("bulk.formationConfirmMessage", {
        formation: label,
        ready: targets.length,
        total: selectedCount,
        // Named, not just counted: a number alone lets an operator confirm a
        // fan-out over drones they did not mean to include.
        names: targets
          .slice(0, 5)
          .map(
            (deviceId) =>
              nameByDeviceId.get(deviceId) ?? tSwarm("table.notRegistered"),
          )
          .join(", "),
      })}
      confirmLabel={tSwarm("bulk.setFormation")}
      onConfirm={onRun}
      onCancel={onCancel}
    />
  );
}
