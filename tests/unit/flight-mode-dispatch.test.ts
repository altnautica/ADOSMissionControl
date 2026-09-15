/**
 * @description The flight-mode dropdown's write path.
 *
 * The defect: the dropdown called `protocol.setFlightMode` directly and, with
 * no protocol, wrote the chosen mode into the local drone store — so the mode
 * label changed and a "Mode changed" toast fired for a command that was never
 * transmitted. With a protocol, the returned CommandResult was discarded, so a
 * vehicle that refused the mode produced no feedback at all.
 *
 * These assert the dropdown's dispatch end-to-end through the same pipeline the
 * panel buttons use: the refusal is surfaced, and no mode the vehicle did not
 * acknowledge is ever reflected locally.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { activate } from "@/lib/skills";
import { useSkillRegistry } from "@/lib/skills/registry";
import { setModeSkill } from "@/lib/skills/builtins/set-mode";
import { resetCooldownState } from "@/lib/skills/cooldown";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import type { SkillContext, SkillProtocol } from "@/lib/skills/types";
import type { CommandResult } from "@/lib/protocol/types";

/**
 * A fresh node id per test. The dispatcher's one-shot debounce is keyed by
 * (droneId, skillId) in module state with no reset seam, so reusing one id
 * would have the second activate in this file swallowed as a double-press.
 */
let seq = 0;
let drone = "";

function clearRegistry(): void {
  useSkillRegistry.setState({
    skills: new Map(),
    states: new Map(),
    _order: new Map(),
    _seq: 0,
  });
}

/** A command sink that answers however the test needs and records the call. */
function sink(answer: CommandResult | Error) {
  const setFlightMode = vi.fn(async (): Promise<CommandResult> => {
    if (answer instanceof Error) throw answer;
    return answer;
  });
  return {
    setFlightMode,
    protocol: { setFlightMode } as unknown as SkillProtocol,
  };
}

function makeCtx(over: Partial<SkillContext> = {}): SkillContext {
  return {
    droneId: drone,
    protocol: null,
    armState: "disarmed",
    flightMode: "STABILIZE",
    availableModes: [],
    previousMode: "STABILIZE",
    supports: () => true,
    checklistReady: true,
    confirm: vi.fn(async () => true),
    notify: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  seq += 1;
  drone = `node:mode-test-${seq}`;
  clearRegistry();
  resetCooldownState();
  useSkillRegistry.getState().register(setModeSkill);
  useDroneManager.setState({ selectedDroneId: drone });
  useDroneStore.setState({ flightMode: "STABILIZE", previousMode: "STABILIZE" });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetCooldownState();
});

describe("flight-mode dispatch", () => {
  it("sends the chosen mode to the vehicle through the pipeline", async () => {
    const s = sink({ success: true, resultCode: 0, message: "ok" });
    await activate("set-mode", makeCtx({ protocol: s.protocol }), {
      targetMode: "GUIDED",
    });
    expect(s.setFlightMode).toHaveBeenCalledWith("GUIDED");
  });

  it("does not reflect a mode the vehicle refused, and says so", async () => {
    const s = sink({
      success: false,
      resultCode: 4,
      message: "pre-arm check failed",
    });
    const ctx = makeCtx({ protocol: s.protocol });

    await activate("set-mode", ctx, { targetMode: "AUTO" });

    // The refusal reaches the operator...
    expect(ctx.notify).toHaveBeenCalledWith("pre-arm check failed", "error");
    // ...and nothing wrote the mode locally. Only a heartbeat may do that.
    expect(useDroneStore.getState().flightMode).toBe("STABILIZE");
  });

  it("does nothing at all with no command path, rather than faking the change", async () => {
    const ctx = makeCtx({ protocol: null });

    await activate("set-mode", ctx, { targetMode: "LOITER" });

    expect(ctx.notify).toHaveBeenCalledWith("skills.reason.noFcLink", "warning");
    expect(useDroneStore.getState().flightMode).toBe("STABILIZE");
    expect(useDroneStore.getState().previousMode).toBe("STABILIZE");
  });

  it("refuses a mode this firmware does not offer without transmitting it", async () => {
    const s = sink({ success: true, resultCode: 0, message: "ok" });
    const ctx = makeCtx({
      protocol: s.protocol,
      availableModes: ["STABILIZE", "LOITER"],
    });

    await activate("set-mode", ctx, { targetMode: "QHOVER" });

    expect(s.setFlightMode).not.toHaveBeenCalled();
    expect(ctx.notify).toHaveBeenCalledWith(
      "skills.reason.modeUnavailable",
      "error",
    );
    expect(useDroneStore.getState().flightMode).toBe("STABILIZE");
  });

  it("sends a mode the GCS cannot verify — an unknown mode list is not proof of absence", async () => {
    const s = sink({ success: true, resultCode: 0, message: "ok" });
    await activate("set-mode", makeCtx({ protocol: s.protocol }), {
      targetMode: "QHOVER",
    });
    expect(s.setFlightMode).toHaveBeenCalledWith("QHOVER");
  });

  it("keeps the parameterised mode skill out of every bindable surface", async () => {
    // It has no meaning without a mode, so a bar slot or hotkey bound to it
    // would do nothing when pressed.
    const resolved = useSkillRegistry.getState().resolveForDrone(drone);
    expect(resolved.map((s) => s.id)).not.toContain("set-mode");
  });
});
