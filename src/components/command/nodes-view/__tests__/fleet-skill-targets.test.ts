/**
 * @module command/nodes-view/fleet-skill-targets.test
 * @description A fleet-wide command (return-all-to-launch) fans over exactly the
 * nodes that can take it right now and honestly skips the rest, so the operator
 * is never told "everything" went home when a node could not hear it (Rule 44).
 * The reach and context resolvers are stubbed so this proves the fan / skip
 * contract itself, not the reach derivation those helpers already cover.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";

// A node whose device id starts with "reach" resolves a working command lane;
// anything else resolves none. That is the only variable the fan reads.
vi.mock("@/lib/nodes/node-reach", () => ({
  describeNodeReach: (node: { deviceId: string }) =>
    node.deviceId.startsWith("reach")
      ? {
          kind: "lan",
          commandable: true,
          reportsVehicleAck: true,
          sink: { supports: () => true },
        }
      : {
          kind: "none",
          commandable: false,
          reportsVehicleAck: false,
          blockedReason: "not-paired",
          sink: null,
        },
}));

// A reachable node has a live flight-state context; the fan never blocks on the
// context here, so a single shape covers every row.
vi.mock("@/lib/skills", () => ({
  activate: vi.fn(),
  useSkillRegistry: vi.fn(),
  buildSkillContextForNode: () => ({ protocol: {} }),
}));

import type { Skill } from "@/lib/skills";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";
import type { CommandAgentLiveness } from "@/lib/nodes/presence";
import type { NodeRowModel } from "@/lib/nodes/node-rows";
import { resolveFleetSkillTargets } from "../use-node-skills";

/** The registered return-to-launch skill drives the `returnToLaunch` method and
 * is otherwise ready — nothing here should be disabled by the skill itself. */
const RETURN_SKILL = {
  id: "rth",
  getState: () => ({ kind: "idle" }),
} as unknown as Skill;

function row(deviceId: string, liveness: CommandAgentLiveness): NodeRowModel {
  return {
    node: { deviceId, _id: `node:${deviceId}` } as FleetNodeEntry,
    summary: { liveness } as CommandAgentSummary,
  };
}

describe("resolveFleetSkillTargets", () => {
  it("fans over every reachable node and skips the unreachable", () => {
    const rows = [
      row("reach-a", "live"),
      row("gone-b", "live"), // no lane resolves
      row("reach-c", "stale"), // still commandable while heard from
    ];
    expect(
      resolveFleetSkillTargets(RETURN_SKILL, rows, {}).map(
        (r) => r.node.deviceId,
      ),
    ).toEqual(["reach-a", "reach-c"]);
  });

  it("skips an offline node even when it would otherwise resolve a lane", () => {
    const rows = [row("reach-a", "live"), row("reach-off", "offline")];
    expect(
      resolveFleetSkillTargets(RETURN_SKILL, rows, {}).map(
        (r) => r.node.deviceId,
      ),
    ).toEqual(["reach-a"]);
  });

  it("returns nothing when no node in the fleet can take the command", () => {
    const rows = [row("gone-a", "live"), row("gone-b", "stale")];
    expect(resolveFleetSkillTargets(RETURN_SKILL, rows, {})).toEqual([]);
  });
});
