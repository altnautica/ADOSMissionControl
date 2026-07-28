"use client";

/**
 * @module command/swarm-view/SwarmActionBar
 * @description Band two: one change applied across the selected slots.
 *
 * This is the nodes board's bulk bar, extended for a fleet. It keeps the two
 * properties that make that bar worth copying. It resolves the action against
 * every selected slot FIRST and says how many can actually take it, so an
 * operator never presses Return-to-launch over eighteen drones believing
 * eighteen are going home. And it takes ONE confirmation for the whole batch,
 * carrying the skill's own typed phrase, because the confirm seam holds a
 * single pending request and per-node dialogs would cancel one another.
 *
 * Arming is still not offered. It is the one action whose blast radius grows
 * with the selection rather than shrinking it, and at twenty-four slots that
 * argument is stronger, not weaker.
 *
 * Formation is not a flight command — the agent's command catalog is closed and
 * would reject it — so it rides the config path instead, with the same
 * "N of M ready" pre-commit count over transports rather than flight gates.
 *
 * @license GPL-3.0-only
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { skillDisplayLabel } from "@/lib/skills/skill-label";
import { useSkillRegistry, type Skill } from "@/lib/skills";
import type { NodeCommandSinkOptions } from "@/lib/nodes/command-sink";
import type { NodeRowModel } from "@/lib/nodes/node-rows";
import type { SwarmSlotRow } from "./swarm-rows";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import {
  SwarmFormationConfirm,
  SwarmSkillConfirm,
} from "./SwarmActionConfirm";
import {
  dispatchSkillForNodes,
  resolveFleetSkillTargets,
} from "@/components/command/nodes-view/use-node-skills";
import type { SwarmBeaconRow } from "@/stores/swarm-beacon-store";
import { useSwarmBulkTargets } from "./use-swarm-bulk-targets";
import { BroadcastGate } from "./BroadcastGate";
import { BROADCAST_ARM_MS, useBroadcastArm } from "./use-broadcast-arm";
import {
  SWARM_CONFIG_KEYS,
  SWARM_FORMATIONS,
  type SwarmFormation,
} from "@/lib/swarm/config-keys";

/**
 * Hold, then the two recoveries. `pause` is the hold: on an auto flight it
 * holds the mission, otherwise it falls back to LOITER — both branches ride
 * every lane. Arm and disarm are absent by design, not by omission.
 */
export const SWARM_BULK_SKILL_IDS: readonly string[] = ["pause", "rth", "land"];

type Pending =
  | { kind: "skill"; skill: Skill; targets: NodeRowModel[] }
  | { kind: "formation"; formation: SwarmFormation; targets: string[] };

export interface SwarmActionBarProps {
  rows: readonly SwarmBeaconRow[];
  nodesBySlot: ReadonlyMap<number, FleetNodeEntry>;
  selectedSlots: ReadonlySet<number>;
  laneOptions: NodeCommandSinkOptions;
  onClear: () => void;
}

export function SwarmActionBar({
  rows,
  nodesBySlot,
  selectedSlots,
  laneOptions,
  onClear,
}: SwarmActionBarProps) {
  const t = useTranslations();
  const tSwarm = useTranslations("swarmView");
  const { toast } = useToast();
  const skills = useSkillRegistry((s) => s.skills);
  const [pending, setPending] = useState<Pending | null>(null);

  const {
    slotRows,
    selectedRows,
    nodeRows,
    configTargets,
    nameByDeviceId,
    isBroadcast,
    configWrite,
  } = useSwarmBulkTargets(rows, nodesBySlot, selectedSlots);

  const broadcast = useBroadcastArm();
  const gated = isBroadcast && !broadcast.armed;

  if (selectedRows.length === 0) return null;

  const skillOptions = SWARM_BULK_SKILL_IDS.flatMap((id) => {
    const skill = skills.get(id);
    if (!skill) return [];
    const ready = resolveFleetSkillTargets(skill, nodeRows, laneOptions);
    return [
      {
        id,
        label: tSwarm("bulk.option", {
          action: skillDisplayLabel(skill, t),
          ready: ready.length,
          total: selectedRows.length,
        }),
        disabled: ready.length === 0,
        title: ready.length === 0 ? tSwarm("bulk.noneReady") : undefined,
      },
    ];
  });

  const formationOptions = SWARM_FORMATIONS.map((name) => ({
    id: name,
    label: tSwarm("bulk.formationOption", {
      formation: tSwarm(`formation.${name}`),
      ready: configTargets.length,
      total: selectedRows.length,
    }),
    disabled: configTargets.length === 0 || configWrite.pending,
    title: configTargets.length === 0 ? tSwarm("bulk.noPath") : undefined,
  }));

  function beginSkill(skillId: string) {
    const skill = skills.get(skillId);
    if (!skill) return;
    const targets = resolveFleetSkillTargets(skill, nodeRows, laneOptions);
    if (targets.length === 0) return;
    setPending({ kind: "skill", skill, targets });
  }

  function beginFormation(name: string) {
    const picked = SWARM_FORMATIONS.find((f) => f === name);
    if (!picked || configTargets.length === 0) return;
    setPending({ kind: "formation", formation: picked, targets: configTargets });
  }

  async function runFormation(targets: string[], name: SwarmFormation) {
    const result = await configWrite.writeValue(
      SWARM_CONFIG_KEYS.formation,
      name,
      targets,
    );
    if (result.failed === 0) {
      toast(
        tSwarm("bulk.formationDone", {
          formation: tSwarm(`formation.${name}`),
          count: result.applied,
        }),
        "success",
      );
      return;
    }
    // Per-target truth, not a blanket "done": a partial fan-out that reports
    // success is the failure mode this whole bar exists to prevent.
    toast(
      tSwarm("bulk.formationPartial", {
        done: result.applied,
        total: result.outcomes.length,
      }),
      "warning",
    );
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-accent-primary/40 bg-accent-primary/5 px-3 py-2">
        <span className="text-xs font-medium text-text-primary">
          {tSwarm("bulk.selected", { count: selectedRows.length })}
        </span>

        {isBroadcast && (
          <BroadcastGate
            armed={broadcast.armed}
            windowMs={BROADCAST_ARM_MS}
            targetCount={slotRows.length}
            onArm={broadcast.arm}
            onDisarm={broadcast.disarm}
          />
        )}

        <DropdownMenu
          align="left"
          items={skillOptions}
          onSelect={beginSkill}
          trigger={
            <button
              type="button"
              disabled={gated}
              title={gated ? tSwarm("broadcast.required") : undefined}
              className="rounded border border-border-default bg-bg-secondary px-2 py-1 text-xs text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
            >
              {tSwarm("bulk.flightAction")}
            </button>
          }
        />

        <DropdownMenu
          align="left"
          items={formationOptions}
          onSelect={beginFormation}
          trigger={
            <button
              type="button"
              disabled={gated}
              title={gated ? tSwarm("broadcast.required") : undefined}
              className="rounded border border-border-default bg-bg-secondary px-2 py-1 text-xs text-text-secondary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
            >
              {tSwarm("bulk.setFormation")}
            </button>
          }
        />

        <button
          type="button"
          onClick={onClear}
          aria-label={tSwarm("bulk.clear")}
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-1 text-xs text-text-tertiary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        >
          <X size={12} />
          {tSwarm("bulk.clear")}
        </button>
      </div>

      {pending?.kind === "skill" && (
        <SwarmSkillConfirm
          skill={pending.skill}
          targets={pending.targets}
          selectedCount={selectedRows.length}
          onRun={() => {
            const { skill, targets } = pending;
            setPending(null);
            broadcast.disarm();
            void dispatchSkillForNodes(
              skill.id,
              targets.map((row) => row.node),
              laneOptions,
            );
          }}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === "formation" && (
        <SwarmFormationConfirm
          formation={pending.formation}
          targets={pending.targets}
          selectedCount={selectedRows.length}
          nameByDeviceId={nameByDeviceId}
          broadcast={isBroadcast}
          onRun={() => {
            const { formation: name, targets } = pending;
            setPending(null);
            broadcast.disarm();
            void runFormation(targets, name);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
