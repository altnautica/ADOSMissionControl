/**
 * @module command/nodes-view/dispatch-skill-for-nodes.test
 * @description A batch command takes one operator confirmation for the whole
 * fleet, and only that: every node still goes through the dispatcher's own
 * gates. A node whose skill is disabled, or whose arm state does not meet the
 * skill's requirement, is refused and told why, while the rest of the batch
 * runs. The per-node context builder is stubbed so each node's arm state and
 * skill state are set directly.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import type { SkillContext, SkillTargetNode } from "@/lib/skills";
import type * as NodeContext from "@/lib/skills/node-context";

const notify = vi.fn();
const confirmDialog = vi.fn(async () => false);

vi.mock("@/lib/skills/node-context", async (importOriginal) => {
  const actual = await importOriginal<typeof NodeContext>();
  return {
    ...actual,
    buildSkillContextForNode: (node: SkillTargetNode): Partial<SkillContext> => ({
      droneId: node._id,
      protocol: null,
      armState: node.deviceId.startsWith("armed") ? "armed" : "disarmed",
      confirm: confirmDialog,
      notify,
    }),
  };
});

import { useSkillRegistry, type Skill } from "@/lib/skills";
import { dispatchSkillForNodes } from "../use-node-skills";

const SKILL_ID = "batch-test-rth";
const performed: string[] = [];

const SKILL: Skill = {
  id: SKILL_ID,
  label: "rth.label",
  icon: "home",
  category: "flight",
  source: "builtin",
  toggle: false,
  confirm: {
    title: "rth.confirm.title",
    message: "rth.confirm.message",
    confirmLabel: "rth.confirm.label",
    variant: "danger",
  },
  armRequirement: "armed",
  getState: (ctx) =>
    ctx.droneId.includes("locked")
      ? { kind: "disabled", reason: "skills.reason.test-locked" }
      : { kind: "idle" },
  activate: async (ctx) => {
    performed.push(ctx.droneId);
  },
};

function node(deviceId: string): SkillTargetNode {
  return { _id: `node:${deviceId}`, deviceId };
}

afterEach(() => {
  useSkillRegistry.getState().unregister(SKILL_ID);
  performed.length = 0;
  notify.mockClear();
  confirmDialog.mockClear();
});

describe("dispatchSkillForNodes", () => {
  it("runs the batch on eligible nodes and refuses disabled or wrong-arm-state nodes", async () => {
    useSkillRegistry.getState().register(SKILL);

    await dispatchSkillForNodes(
      SKILL_ID,
      [node("armed-a"), node("armed-locked"), node("idle-b"), node("armed-c")],
      {},
    );

    expect(performed.sort()).toEqual(["node:armed-a", "node:armed-c"]);
    expect(notify).toHaveBeenCalledWith("skills.reason.test-locked", "warning");
    expect(notify).toHaveBeenCalledWith("skills.reason.notArmed", "warning");
    // The batch confirmation replaces the per-node dialog; none opens.
    expect(confirmDialog).not.toHaveBeenCalled();
  });
});
