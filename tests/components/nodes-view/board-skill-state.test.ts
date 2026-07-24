/**
 * Tests for the fleet board's control gating: which cause a disabled control
 * reports, in which order, and that a control the node's lane cannot carry is
 * never left pressable.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import {
  boardBlockReason,
  methodForSkill,
  resolveBoardSkillState,
} from "@/components/command/nodes-view/use-node-skills";
import type { NodeReachDescriptor } from "@/lib/nodes/node-reach";
import type { NodeCommandSink } from "@/lib/nodes/command-sink";
import type { Skill, SkillContext, SkillProtocol } from "@/lib/skills";
import { armSkill } from "@/lib/skills/builtins/arm";
import { landSkill } from "@/lib/skills/builtins/land";

/** A sink that carries everything except the methods named. */
function sinkWithout(...missing: (keyof SkillProtocol)[]): NodeCommandSink {
  return {
    transport: "lan",
    reportsVehicleAck: true,
    supports: (method) => !missing.includes(method),
  } as NodeCommandSink;
}

function reachable(
  sink: NodeCommandSink = sinkWithout(),
): NodeReachDescriptor {
  return {
    kind: "lan",
    commandable: true,
    reportsVehicleAck: true,
    sink,
  };
}

const UNREACHABLE: NodeReachDescriptor = {
  kind: "none",
  commandable: false,
  reportsVehicleAck: false,
  blockedReason: "not-paired",
  sink: null,
};

const DIRECT_FC: NodeReachDescriptor = {
  kind: "direct-fc",
  commandable: false,
  reportsVehicleAck: false,
  blockedReason: "direct-fc",
  sink: null,
};

function ctxWith(overrides: Partial<SkillContext> = {}): SkillContext {
  return {
    droneId: "node:alpha",
    protocol: {} as SkillProtocol,
    armState: "disarmed",
    flightMode: "MANUAL",
    availableModes: [],
    previousMode: "MANUAL",
    supports: () => false,
    checklistReady: false,
    confirm: async () => true,
    notify: () => {},
    ...overrides,
  };
}

describe("methodForSkill", () => {
  it("maps every mode preset onto the one mode-setting method", () => {
    expect(methodForSkill("mode.loiter")).toBe("setFlightMode");
    expect(methodForSkill("mode.auto")).toBe("setFlightMode");
  });

  it("routes kill / pause / resume onto their lane methods", () => {
    // These are board controls now, each mapped to the command its skill drives.
    expect(methodForSkill("kill")).toBe("killSwitch");
    expect(methodForSkill("pause")).toBe("pauseMission");
    expect(methodForSkill("resume")).toBe("resumeMission");
  });

  it("returns null for a skill the board does not surface", () => {
    // A behavior skill the board does not carry as a flight control has no
    // board method, so it is not treated as a control it knows how to run.
    expect(methodForSkill("follow-me")).toBeNull();
  });
});

describe("boardBlockReason", () => {
  it("reports an offline node ahead of everything else", () => {
    // LAN credentials never expire and a heartbeat row survives its node, so
    // an offline node still resolves a lane — the honest cause is that it is
    // gone, whatever else its persisted state would say.
    expect(
      boardBlockReason(reachable(), ctxWith(), "arm", "offline", false),
    ).toBe("nodesView.reason.nodeOffline");
    expect(
      boardBlockReason(UNREACHABLE, ctxWith(), "arm", "offline", false),
    ).toBe("nodesView.reason.nodeOffline");
  });

  it("keeps a stale node's controls with the skill — stale is not gone", () => {
    expect(
      boardBlockReason(reachable(), ctxWith(), "arm", "stale", false),
    ).toBeNull();
  });

  it("reports the reach cause first — it is the most actionable", () => {
    expect(boardBlockReason(UNREACHABLE, ctxWith(), "arm", "live", false)).toBe(
      "nodesView.blocked.not-paired",
    );
    expect(boardBlockReason(DIRECT_FC, ctxWith(), "arm", "live", false)).toBe(
      "nodesView.blocked.direct-fc",
    );
  });

  it("refuses a command the reaching lane cannot carry", () => {
    // Left pressable, this is the case that looks like it worked and did not.
    expect(
      boardBlockReason(
        reachable(sinkWithout("killSwitch")),
        ctxWith(),
        "killSwitch",
        "live",
        false,
      ),
    ).toBe("nodesView.reason.notOnThisLane");
  });

  it("refuses a skill the board has no lane mapping for", () => {
    expect(boardBlockReason(reachable(), ctxWith(), null, "live", false)).toBe(
      "nodesView.reason.notOnThisLane",
    );
  });

  it("names the missing flight state rather than a missing link", () => {
    // The context withholds its command surface until the node's own arm state
    // has been read; saying "no FC link" there would point at the wrong fault.
    expect(
      boardBlockReason(
        reachable(),
        ctxWith({ protocol: null }),
        "arm",
        "live",
        false,
      ),
    ).toBe("nodesView.reason.noFlightState");
  });

  it("defers to the skill when nothing about the node blocks it", () => {
    expect(
      boardBlockReason(reachable(), ctxWith(), "arm", "live", false),
    ).toBeNull();
  });
});

describe("boardBlockReason — autonomous-nav gate", () => {
  // A control that needs autonomous navigation (RTL/Land/Takeoff) is refused on
  // a firmware known to lack it, but only once the node is otherwise fully
  // reachable and live — the vehicle's real capability limit, surfaced instead
  // of an enabled safety-return it cannot perform. The board reads the same
  // tri-state the cockpit's resolveForDrone reads.

  it("refuses an autonomous-nav control on a firmware known to lack it", () => {
    expect(
      boardBlockReason(
        reachable(),
        ctxWith({ autonomousNav: "unsupported" }),
        "returnToLaunch",
        "live",
        true,
      ),
    ).toBe("nodesView.reason.noAutonomousNav");
  });

  it("keeps it when the firmware supports autonomous nav", () => {
    expect(
      boardBlockReason(
        reachable(),
        ctxWith({ autonomousNav: "supported" }),
        "returnToLaunch",
        "live",
        true,
      ),
    ).toBeNull();
  });

  it("keeps it when the capability is merely unknown — not-connected is not cannot", () => {
    expect(
      boardBlockReason(
        reachable(),
        ctxWith({ autonomousNav: "unknown" }),
        "returnToLaunch",
        "live",
        true,
      ),
    ).toBeNull();
  });

  it("never touches a control that does not need autonomous nav", () => {
    expect(
      boardBlockReason(
        reachable(),
        ctxWith({ autonomousNav: "unsupported" }),
        "arm",
        "live",
        false,
      ),
    ).toBeNull();
  });

  it("reports offline ahead of the firmware limit", () => {
    expect(
      boardBlockReason(
        reachable(),
        ctxWith({ autonomousNav: "unsupported" }),
        "returnToLaunch",
        "offline",
        true,
      ),
    ).toBe("nodesView.reason.nodeOffline");
  });

  it("reports an unreachable node's reach cause ahead of the firmware limit", () => {
    expect(
      boardBlockReason(
        UNREACHABLE,
        ctxWith({ autonomousNav: "unsupported" }),
        "returnToLaunch",
        "live",
        true,
      ),
    ).toBe("nodesView.blocked.not-paired");
  });
});

describe("resolveBoardSkillState", () => {
  it("hands a reachable node's control to the skill's own gate", () => {
    // Land is armed-only, so a disarmed node reports the skill's reason.
    const state = resolveBoardSkillState(
      landSkill,
      ctxWith({ armState: "disarmed" }),
      reachable(),
      "live",
    );
    expect(state).toEqual({ kind: "disabled", reason: "skills.reason.notArmed" });
  });

  it("leaves a runnable control idle", () => {
    const state = resolveBoardSkillState(
      armSkill,
      ctxWith({ armState: "disarmed" }),
      reachable(),
      "live",
    );
    expect(state.kind).toBe("idle");
  });

  it("blocks on reach before ever consulting the skill", () => {
    const exploded: Skill = {
      ...armSkill,
      getState: () => {
        throw new Error("the skill must not be consulted for an unreachable node");
      },
    };
    expect(
      resolveBoardSkillState(exploded, ctxWith(), UNREACHABLE, "live"),
    ).toEqual({
      kind: "disabled",
      reason: "nodesView.blocked.not-paired",
    });
  });

  it("disables an offline node's control with the offline reason", () => {
    const state = resolveBoardSkillState(
      armSkill,
      ctxWith({ armState: "disarmed" }),
      reachable(),
      "offline",
    );
    expect(state).toEqual({
      kind: "disabled",
      reason: "nodesView.reason.nodeOffline",
    });
  });
});
