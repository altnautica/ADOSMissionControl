"use client";

/**
 * @module command/nodes-view/use-node-skills
 * @description Resolves one board row's flight actions against the node in that
 * row, and dispatches them through the shared skill pipeline.
 *
 * Every control on the board runs an existing skill. Nothing here sends a
 * command: it builds the node's own skill context, asks each skill what its
 * state is against that context, and hands presses to the dispatcher — so the
 * confirmation dialogs, typed phrases, arm gating, charge budgets, cooldowns
 * and press debouncing that guard the cockpit guard the board identically. A
 * second command path would be a second set of safety gates to keep in step,
 * and they would not stay in step.
 *
 * Four gates run before a skill's own, because each names a cause the skill
 * cannot see and each is more actionable than "no link":
 *
 *  1. the node is offline — nothing is being heard from it, so whatever lane
 *     its credentials would resolve, no command can honestly be offered;
 *  2. nothing can reach this node — the reach descriptor says which cause;
 *  3. the lane that reaches it cannot carry this particular command, which is
 *     the case that would otherwise look like it worked and quietly do nothing;
 *  4. no live flight state is being read from the node, so there is no arm
 *     state to gate on and no command is dispatched blind.
 *
 * @license GPL-3.0-only
 */

import { useCallback } from "react";

import {
  activate,
  buildSkillContextForNode,
  useSkillRegistry,
  type Skill,
  type SkillContext,
  type SkillProtocol,
  type SkillState,
  type SkillTargetNode,
} from "@/lib/skills";
import type { NodeCommandSinkOptions } from "@/lib/nodes/command-sink";
import { describeNodeReach, type NodeReachDescriptor } from "@/lib/nodes/node-reach";
import type { NodeRowModel } from "@/lib/nodes/node-rows";
import type { CommandAgentLiveness } from "@/lib/nodes/presence";

/** The flight actions this board exposes, and their labels. */
export const BOARD_ACTION_SKILLS = ["arm", "disarm", "rth", "land"] as const;

/** The mode presets the flight-mode control offers, in menu order. */
export const BOARD_MODE_SKILLS = [
  "mode.stabilize",
  "mode.althold",
  "mode.loiter",
  "mode.guided",
  "mode.auto",
] as const;

/**
 * The command-lane method each board skill drives. A skill whose method the
 * lane cannot carry is refused rather than dispatched: the sink answers such a
 * command with a failure the skill never reads, so it would look like it
 * worked. Anything not listed here is not a board control.
 */
const SKILL_METHOD: Record<string, keyof SkillProtocol> = {
  arm: "arm",
  disarm: "disarm",
  rth: "returnToLaunch",
  land: "land",
};

function methodForSkill(skillId: string): keyof SkillProtocol | null {
  if (skillId.startsWith("mode.")) return "setFlightMode";
  return SKILL_METHOD[skillId] ?? null;
}

/** One resolved control: what to render, whether it is live, and why not. */
export interface NodeSkillAction {
  id: string;
  /** The registered skill, so a caller resolves its label the shared way. */
  skill: Skill;
  state: SkillState;
  disabled: boolean;
  /** Fully-qualified i18n key naming why it is disabled, when it is. */
  reasonKey: string | null;
  run: () => void;
}

export interface NodeSkills {
  /** The node's own skill context, rebuilt on every render from its telemetry. */
  ctx: SkillContext;
  /** Resolve one skill for this node, or null when it is not registered. */
  resolve: (skillId: string) => NodeSkillAction | null;
}

/**
 * Why a board control cannot run, ahead of the skill's own gates. Null means
 * the skill decides. Exported for tests: this ordering is the board's safety
 * contract, and it has to hold without a React tree to prove it.
 */
export function boardBlockReason(
  reach: NodeReachDescriptor,
  ctx: SkillContext,
  method: keyof SkillProtocol | null,
  liveness: CommandAgentLiveness,
): string | null {
  // Offline comes first: LAN credentials never expire and a heartbeat row
  // survives its node, so an offline node can still resolve a lane — but with
  // nothing hearing from it, the honest cause is that it is gone, not that
  // some particular lane or reading is missing. The context withholds its
  // command surface on the same clock, so this is a label, not the gate.
  if (liveness === "offline") return "nodesView.reason.nodeOffline";
  if (!reach.commandable) {
    return reach.blockedReason
      ? `nodesView.blocked.${reach.blockedReason}`
      : "nodesView.blocked.not-paired";
  }
  if (method === null || !reach.sink?.supports(method)) {
    return "nodesView.reason.notOnThisLane";
  }
  // The context withholds its command surface until the node's own arm state
  // has actually been read, so this is the honest cause — not "no FC link".
  if (!ctx.protocol) return "nodesView.reason.noFlightState";
  return null;
}

/**
 * One board control's state: the board's own gates first, then the skill's.
 * Pure, so the gate ordering is provable without mounting a row.
 */
export function resolveBoardSkillState(
  skill: Skill,
  ctx: SkillContext,
  reach: NodeReachDescriptor,
  liveness: CommandAgentLiveness,
): SkillState {
  const blocked = boardBlockReason(
    reach,
    ctx,
    methodForSkill(skill.id),
    liveness,
  );
  return blocked ? { kind: "disabled", reason: blocked } : skill.getState(ctx);
}

/** The command-lane method a board skill drives, or null when it is not one. */
export { methodForSkill };

/**
 * The fleet rows a skill can actually be dispatched to right now — the same gate
 * stack a single row's own control runs, applied across the fleet. A fleet-wide
 * command fans over exactly these rows and honestly skips the rest, so "return
 * everything home" never claims to reach a node that cannot hear it (Rule 44).
 * Pure and exported so the fan / skip contract holds without mounting the
 * confirmation dialog that consumes it.
 */
export function resolveFleetSkillTargets(
  skill: Skill,
  rows: readonly NodeRowModel[],
  options: NodeCommandSinkOptions,
): NodeRowModel[] {
  return rows.filter((row) => {
    const reach = describeNodeReach(row.node, options);
    const ctx = buildSkillContextForNode(row.node, options);
    return (
      resolveBoardSkillState(skill, ctx, reach, row.summary.liveness).kind !==
      "disabled"
    );
  });
}

/**
 * Run one skill across several nodes after the operator has already confirmed
 * the batch.
 *
 * The confirm seam holds ONE pending request and cancels any prior one, so
 * looping the dispatcher over N nodes would have each node's dialog cancel the
 * last — the operator would confirm once and N-1 commands would silently
 * abort. Instead the caller takes a single confirmation for the whole batch,
 * and each node's context reports that confirmation as already given. Every
 * other gate the dispatcher runs — disabled state, arm requirement, charges,
 * press debounce — still runs per node.
 *
 * Dispatch is concurrent because the remaining guards are all keyed per node,
 * and because a fleet-wide recovery command should not queue behind another
 * node's round trip.
 */
export async function dispatchSkillForNodes(
  skillId: string,
  nodes: readonly SkillTargetNode[],
  options: NodeCommandSinkOptions,
): Promise<void> {
  await Promise.all(
    nodes.map((node) => {
      const ctx = buildSkillContextForNode(node, options);
      return activate(skillId, { ...ctx, confirm: async () => true });
    }),
  );
}

export function useNodeSkills(
  node: SkillTargetNode,
  reach: NodeReachDescriptor,
  options: NodeCommandSinkOptions,
  liveness: CommandAgentLiveness,
): NodeSkills {
  // Subscribing to the registry keeps the board in step with skills that
  // register or unregister while it is open.
  const skills = useSkillRegistry((s) => s.skills);

  // Rebuilt per render rather than cached: the cached states the registry keeps
  // are only ever recomputed for the focused node, so a row reading them would
  // show another node's truth.
  const ctx = buildSkillContextForNode(node, options);

  const resolve = useCallback(
    (skillId: string): NodeSkillAction | null => {
      const skill = skills.get(skillId);
      if (!skill) return null;

      const state = resolveBoardSkillState(skill, ctx, reach, liveness);
      const disabled = state.kind === "disabled";

      return {
        id: skillId,
        skill,
        state,
        disabled,
        reasonKey: disabled ? (state.reason ?? null) : null,
        run: () => {
          if (disabled) return;
          // Rebuilt at press time so the command carries the node's newest
          // state, not whatever it held when the row last rendered.
          void activate(skillId, buildSkillContextForNode(node, options));
        },
      };
    },
    [skills, ctx, reach, liveness, node, options],
  );

  return { ctx, resolve };
}
