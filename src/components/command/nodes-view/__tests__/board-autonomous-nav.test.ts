/**
 * @module command/nodes-view/board-autonomous-nav.test
 * @description A board control that needs autonomous navigation (return-to-launch,
 * land, take-off) is refused on a node whose firmware is known to lack it — an
 * acro flight controller — even when the node is fully reachable and its live
 * flight state is being read, so the board never offers a safety-return the
 * vehicle cannot perform (Rule 44). The board reads the same tri-state the
 * cockpit reads: "supported" and "unknown" both keep the control, only a
 * known-unsupported firmware drops it, so the board and the cockpit agree for one
 * node. Every board surface — the row action menu, the flight-mode menu, and the
 * bulk fleet fan — resolves through the one gate proven here.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";

// resolveFleetSkillTargets resolves each node's reach + context through these.
// The reach is a working LAN lane for every node; the context lets a node's
// firmware decide its autonomous-nav capability, which is the only variable the
// fleet fan reads here.
vi.mock("@/lib/nodes/node-reach", () => ({
  describeNodeReach: () => ({
    kind: "lan",
    commandable: true,
    reportsVehicleAck: true,
    sink: { supports: () => true },
  }),
}));

vi.mock("@/lib/skills", () => ({
  activate: vi.fn(),
  useSkillRegistry: vi.fn(),
  buildSkillContextForNode: (node: { fcFirmware?: string }) => ({
    protocol: {},
    autonomousNav:
      node.fcFirmware === "ardupilot"
        ? "supported"
        : node.fcFirmware === "betaflight"
          ? "unsupported"
          : "unknown",
  }),
}));

import type { Skill, SkillContext } from "@/lib/skills";
import type { NodeReachDescriptor } from "@/lib/nodes/node-reach";
import type { NodeRowModel } from "@/lib/nodes/node-rows";
import {
  resolveBoardSkillState,
  resolveFleetSkillTargets,
} from "../use-node-skills";

/** Return-to-launch and land are the board's autonomous-nav controls. */
const RTH_SKILL = {
  id: "rth",
  requiresAutonomousNav: true,
  getState: () => ({ kind: "idle" }),
} as unknown as Skill;

const LAND_SKILL = {
  id: "land",
  requiresAutonomousNav: true,
  getState: () => ({ kind: "idle" }),
} as unknown as Skill;

/** Arm does not need autonomous nav; the gate must never touch it. */
const ARM_SKILL = {
  id: "arm",
  getState: () => ({ kind: "idle" }),
} as unknown as Skill;

/** A node this board can reach and command over the LAN. */
const REACHABLE = {
  kind: "lan",
  commandable: true,
  reportsVehicleAck: true,
  sink: { supports: () => true },
} as unknown as NodeReachDescriptor;

/** A node the board cannot command at all. */
const NOT_PAIRED = {
  kind: "none",
  commandable: false,
  reportsVehicleAck: false,
  blockedReason: "not-paired",
  sink: null,
} as unknown as NodeReachDescriptor;

/** A live, flight-state-proven context whose only variable is nav capability. */
function ctx(nav: SkillContext["autonomousNav"]): SkillContext {
  return { protocol: {}, autonomousNav: nav } as unknown as SkillContext;
}

describe("resolveBoardSkillState — autonomous-nav gate", () => {
  // This is the choke point every board surface resolves through: the row
  // action menu and the flight-mode menu via `skills.resolve`, and the bulk bar
  // via `readyNodes` — all call resolveBoardSkillState, so proving it here
  // proves the gate for each of them.

  it("disables RTL and Land with a reason on a reachable node whose firmware lacks autonomous nav", () => {
    // The regression this closes: a directly-connected acro FC (Betaflight) is
    // fully reachable and live, so without the gate its RTL/Land read enabled —
    // an enabled safety-return the vehicle cannot perform.
    for (const skill of [RTH_SKILL, LAND_SKILL]) {
      expect(
        resolveBoardSkillState(skill, ctx("unsupported"), REACHABLE, "live"),
      ).toEqual({ kind: "disabled", reason: "nodesView.reason.noAutonomousNav" });
    }
  });

  it("keeps RTL and Land enabled on a node whose firmware supports autonomous nav", () => {
    for (const skill of [RTH_SKILL, LAND_SKILL]) {
      expect(
        resolveBoardSkillState(skill, ctx("supported"), REACHABLE, "live").kind,
      ).toBe("idle");
    }
  });

  it("does not over-block RTL/Land on a node whose nav capability is unknown", () => {
    // "unknown" is an un-handshaken node, not a firmware that cannot: keep it.
    expect(
      resolveBoardSkillState(RTH_SKILL, ctx("unknown"), REACHABLE, "live").kind,
    ).toBe("idle");
  });

  it("never touches a control that does not need autonomous nav", () => {
    expect(
      resolveBoardSkillState(ARM_SKILL, ctx("unsupported"), REACHABLE, "live")
        .kind,
    ).toBe("idle");
  });

  it("reports the more actionable cause first: an offline acro node reads offline, not the firmware limit", () => {
    expect(
      resolveBoardSkillState(RTH_SKILL, ctx("unsupported"), REACHABLE, "offline"),
    ).toEqual({ kind: "disabled", reason: "nodesView.reason.nodeOffline" });
  });

  it("reports an unreachable acro node as unreachable, not as the firmware limit", () => {
    expect(
      resolveBoardSkillState(RTH_SKILL, ctx("unsupported"), NOT_PAIRED, "live"),
    ).toEqual({ kind: "disabled", reason: "nodesView.blocked.not-paired" });
  });
});

function row(fcFirmware: string): NodeRowModel {
  return {
    node: { deviceId: `dev:${fcFirmware}`, _id: `node:${fcFirmware}`, fcFirmware },
    summary: { liveness: "live" },
  } as unknown as NodeRowModel;
}

describe("resolveFleetSkillTargets — the bulk fleet fan honours the same gate", () => {
  it("fans a fleet return-to-launch over the autonomous-capable nodes and skips the acro one", () => {
    const rows = [row("ardupilot"), row("betaflight"), row("unidentified")];
    const targets = resolveFleetSkillTargets(RTH_SKILL, rows, {}).map(
      (r) => r.node._id,
    );
    // supported keeps it, unknown keeps it (not over-blocked), unsupported skips.
    expect(targets).toContain("node:ardupilot");
    expect(targets).toContain("node:unidentified");
    expect(targets).not.toContain("node:betaflight");
  });
});
