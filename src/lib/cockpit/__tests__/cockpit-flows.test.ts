/**
 * Cockpit flows: views, the controller gesture engine, plan identity, the
 * pre-flight checklist's pilot items, the launch arguments, banner and voice
 * text, and the nav-status fallback poll.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { nextView, VIEW_CYCLE, DEFAULT_VIEW } from "@/lib/cockpit/views";
import {
  GestureEngine,
  SPEC_BINDINGS,
  bindingConflicts,
  missingLocked,
  type Ds4Binding,
} from "@/lib/input/ds4-bindings";
import { planIdentity } from "@/lib/mission/plan-identity";
import { evaluateAutoChecks } from "@/lib/checklist/auto-checks";
import { launchArgs } from "@/components/cockpit/v2/LaunchSheet";
import { bannerText, voiceLine } from "@/components/cockpit/v2/FlightFlowOverlays";
import { specString } from "@/lib/cockpit/spec-strings";
import { widthClassFor } from "@/lib/cockpit/width-class";
import type { MissionState } from "@/lib/cockpit/layers/cockpit-frames";
import { pollNavStatus } from "@/lib/agent/nav-stream";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import pilotFixture from "@/lib/cockpit/layers/fixtures/pilot-frame.json";

describe("cockpit views", () => {
  it("cycles pilot → map → split → vision → pilot", () => {
    expect(DEFAULT_VIEW).toBe("pilot");
    expect(VIEW_CYCLE).toEqual(["pilot", "map", "split", "vision"]);
    expect(nextView("vision")).toBe("pilot");
    expect(nextView("pilot")).toBe("map");
  });

  it("uses the spec breakpoints", () => {
    expect(widthClassFor(599, false)).toBe("compact");
    expect(widthClassFor(839, false)).toBe("medium");
    expect(widthClassFor(840, false)).toBe("expanded");
    expect(widthClassFor(1600, false)).toBe("tv");
  });
});

/** Drive the engine with a scripted press timeline. */
function run(
  bindings: readonly Ds4Binding[],
  steps: [number, string[]][],
  when: (c: string) => boolean = (c) => c === "picker_closed" || c === "on_ground" || c === "not_rth" || c === "stick_l_centered",
): string[] {
  const fired: string[] = [];
  const e = new GestureEngine(bindings, { when, fire: (b) => fired.push(b.action) });
  for (const [t, down] of steps) e.update((c) => down.includes(c), t);
  return fired;
}

describe("controller gesture engine", () => {
  it("PS tap pauses, PS held 2 s returns home", () => {
    expect(run(SPEC_BINDINGS, [[0, ["ps"]], [100, []]])).toEqual(["pause"]);
    // The brake fires on press; held on, it escalates to return home.
    expect(run(SPEC_BINDINGS, [[0, ["ps"]]])).toEqual(["pause"]);
    expect(run(SPEC_BINDINGS, [[0, ["ps"]], [1000, ["ps"]], [2000, ["ps"]], [2100, []]])).toEqual(["pause", "rth"]);
  });

  it("PS tap during RTH cancels it", () => {
    const fired = run(SPEC_BINDINGS, [[0, ["ps"]], [100, []]], (c) => c === "rth_active");
    expect(fired).toEqual(["rth_cancel"]);
  });

  it("L1 + R1 held 2 s arms and fires neither zoom", () => {
    const fired = run(SPEC_BINDINGS, [
      [0, ["l1"]],
      [50, ["l1", "r1"]],
      [1000, ["l1", "r1"]],
      [2100, ["l1", "r1"]],
      [2200, []],
    ]);
    expect(fired).toEqual(["arm"]);
  });

  it("an arm hold with the left stick off centre does not arm", () => {
    const fired = run(
      SPEC_BINDINGS,
      [[0, ["l1", "r1"]], [1000, ["l1", "r1"]], [2100, ["l1", "r1"]], [2200, []]],
      (c) => c === "picker_closed",
    );
    expect(fired).toEqual([]);
  });

  it("L2 + R2 + Circle held 3 s is the emergency stop, not Stop skill", () => {
    const fired = run(SPEC_BINDINGS, [[0, ["l2", "r2"]], [10, ["l2", "r2", "circle"]], [3100, ["l2", "r2", "circle"]], [3200, []]]);
    expect(fired).toEqual(["kill"]);
  });

  it("Triangle tap cycles the view; held on the ground takes off", () => {
    expect(run(SPEC_BINDINGS, [[0, ["triangle"]], [100, []], [500, []]])).toEqual(["view_next"]);
    expect(run(SPEC_BINDINGS, [[0, ["triangle"]], [1600, ["triangle"]], [1700, []]])).toEqual(["takeoff"]);
  });

  it("D-pad up is the layer level with the picker closed, a parameter step with it open", () => {
    expect(run(SPEC_BINDINGS, [[0, ["dpad_up"]], [50, []]])).toEqual(["layer_level_up"]);
    expect(run(SPEC_BINDINGS, [[0, ["dpad_up"]], [50, []]], (c) => c === "picker_open")).toEqual(["param_up"]);
  });

  it("the spec table has no conflicts and every locked binding", () => {
    expect(bindingConflicts(SPEC_BINDINGS).size).toBe(0);
    expect(missingLocked(SPEC_BINDINGS)).toEqual([]);
  });

  it("binding a second action to the same gesture is a conflict; dropping pause is missing a lock", () => {
    const dup = [...SPEC_BINDINGS, { ...SPEC_BINDINGS.find((b) => b.action === "photo")!, action: "record_toggle" }];
    expect(bindingConflicts(dup).size).toBe(2);
    const noPause = SPEC_BINDINGS.filter((b) => !(b.action === "pause" && b.control === "ps"));
    // Options + Circle still pauses (a combo tap), so the lone tap lock is missing.
    expect(missingLocked(noPause)).toEqual(["pause (tap)"]);
  });
});

const mission = (m: Partial<MissionState>): MissionState => ({
  state: "loaded",
  seq: 0,
  total: 5,
  itemReached: null,
  id: 0,
  source: "mission_state",
  ageMs: 0,
  landingSeq: false,
  uploadsSeen: null,
  ...m,
});

describe("plan identity", () => {
  const receipt = { droneId: "d", contentHash: "h", at: 0, total: 5, uploadsSeenBefore: 3 };
  it("matches on a non-zero opaque id", () => {
    expect(planIdentity({ ...receipt, opaqueId: 77 }, mission({ id: 77 }))).toBe("match");
    expect(planIdentity({ ...receipt, opaqueId: 76 }, mission({ id: 77 }))).toBe("differs");
  });
  it("with id 0 matches on total while no other upload was seen", () => {
    expect(planIdentity(receipt, mission({ uploadsSeen: 4 }))).toBe("match");
    expect(planIdentity(receipt, mission({ uploadsSeen: 5 }))).toBe("differs");
    expect(planIdentity(receipt, mission({ total: 6 }))).toBe("differs");
  });
  it("is unknown without an agent mission state", () => {
    expect(planIdentity(receipt, null)).toBe("unknown");
    expect(planIdentity(undefined, mission({ state: "none", total: 0 }))).toBe("unknown");
    expect(planIdentity(undefined, mission({}))).toBe("differs");
  });
});

describe("pre-flight checklist pilot items", () => {
  const base = {
    battery: undefined,
    knownCellCount: null,
    gps: undefined,
    ekf: undefined,
    sysStatus: undefined,
    missionOnVehicle: null,
    fenceOnVehicle: null,
    formatGpsFix: () => "",
  };
  it("fails on a red pilot readiness item and a missing controller in ados mode", () => {
    const v = evaluateAutoChecks(
      {
        ...base,
        pilot: { readiness: [{ id: "fc_profile", ok: false, severity: "block", msg: "FC profile differs" }], controlMode: "ados" },
        controllerConnected: false,
        linkFresh: true,
        diskPercent: 40,
      },
      Date.now(),
    );
    expect(v["pilot-readiness"]).toEqual({ status: "fail", displayValue: "FC profile differs" });
    expect(v.controller.status).toBe("fail");
    expect(v["link-fresh"].status).toBe("pass");
    expect(v.storage).toEqual({ status: "pass", displayValue: "60% free" });
  });
  it("does not need a pilot or a controller on a direct link", () => {
    const v = evaluateAutoChecks({ ...base, pilot: null, controllerConnected: false }, Date.now());
    expect(v["pilot-readiness"].status).toBe("pass");
    expect(v.controller.status).toBe("pass");
    expect(v.storage.status).toBe("pending");
  });
});

describe("launch, banners and voice", () => {
  it("builds the launch arguments", () => {
    expect(launchArgs({ after: "hold", altM: 3, skillId: null, gotoNE: [0, 0], whenDone: "none" })).toEqual({ after: "hold", alt_m: 3 });
    expect(launchArgs({ after: "skill", altM: 3, skillId: "follow-me:follow", gotoNE: [0, 0], whenDone: "rth" })).toEqual({
      after: "skill",
      alt_m: 3,
      skill: { plugin_id: "follow-me", skill_id: "follow" },
      when_done: "rth",
    });
    expect(launchArgs({ after: "goto", altM: 5, skillId: null, gotoNE: [10, -4], whenDone: "land" }).goto).toEqual({ n: 10, e: -4, d: -5 });
  });

  it("renders the handover banner from the spec strings", () => {
    expect(bannerText({ textKey: "pilot.banner.ados_engaged", args: { source: "rc" }, untilMs: null })).toBe("ADOS engaged by RC switch");
    expect(bannerText({ textKey: "pilot.banner.ados_control", args: { profile: "normal" }, untilMs: null })).toBe(
      "ADOS has control · PILOT NORMAL",
    );
  });

  it("speaks handovers, RTH, low battery and mission changes", () => {
    const s = (owner: string | null, mission: string | null = null, rth = false, fcModeName: string | null = null) => ({ owner, fcModeName, mission, rth });
    expect(voiceLine(s("fc_mode"), s("pilot"))).toBe(specString("voice.ados_control"));
    expect(voiceLine(s("pilot"), s("fc_mode", null, false, "LOITER"))).toBe(specString("voice.fc_control"));
    expect(voiceLine(s("pilot"), s("fc_mode", null, false, "RTL"))).toBe(specString("voice.rth"));
    expect(voiceLine(s("pilot"), s("pilot", null, true))).toBe(specString("voice.low_battery"));
    expect(voiceLine(s("mission_fc", "active"), s("mission_fc", "complete"))).toBe(specString("voice.mission_complete"));
    expect(voiceLine(s("pilot"), s("pilot"))).toBeNull();
  });
});

describe("nav status fallback poll", () => {
  afterEach(() => vi.restoreAllMocks());
  it("ingests every kind with its drone-side age", async () => {
    const fixture = pilotFixture as { data?: unknown };
    const body = {
      pilot: { ts_ms: 10, age_ms: 300, data: fixture.data ?? fixture },
      ar: null,
      view_demand: {},
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const ok = await pollNavStatus({ baseUrl: "http://agent.local", apiKey: "k" }, "d1", undefined, () => 10_000);
    expect(ok).toBe(true);
    const pilot = useNavStreamStore.getState().byDrone.d1?.pilot;
    expect(pilot?.receivedAt).toBe(9_700);
  });
});
