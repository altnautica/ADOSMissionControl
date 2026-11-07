import { describe, expect, it } from "vitest";

import { fcSetupUrls } from "../client";
import { parseAction, parseFrame, parseStep, setupNeeded } from "../parse";

const accel = {
  wizard: "ground",
  step: "accel",
  title_key: "setup.step.accel.title",
  body_key: "setup.step.accel.body",
  args: { pose: "level", inputs: { cells: { kind: "number", label_key: "setup.input.cells", value: 4, min: 1, max: 14 } } },
  image: "accel_level",
  state: "waiting_user",
  progress: 1.4,
  live: { pose: "level", poses_done: 0 },
  actions: [
    { id: "next_pose", label_key: "setup.action.next_pose", style: "primary", confirm: "none" },
    { id: "bad", label_key: "x", style: "loud", confirm: "none" },
  ],
  blockers: ["setup.blocker.armed", 3],
  result: null,
};

describe("setup step parser ", () => {
  it("parses a step, clamps progress, drops malformed actions and blockers", () => {
    const s = parseStep(accel);
    expect(s).not.toBeNull();
    expect(s!.state).toBe("waiting_user");
    expect(s!.progress).toBe(1);
    expect(s!.actions.map((a) => a.id)).toEqual(["next_pose"]);
    expect(s!.blockers).toEqual(["setup.blocker.armed"]);
    expect(s!.inputs[0]).toMatchObject({ name: "cells", kind: "number", value: 4, min: 1, max: 14 });
    expect(s!.args.inputs).toBeUndefined();
  });

  it("accepts every step state and rejects unknown ones", () => {
    for (const state of ["pending", "running", "waiting_user", "done", "failed", "skipped"]) {
      expect(parseStep({ ...accel, state })?.state).toBe(state);
    }
    expect(parseStep({ ...accel, state: "paused" })).toBeNull();
    expect(parseStep({ ...accel, step: undefined })).toBeNull();
    expect(parseStep(null)).toBeNull();
  });

  it("parses the three confirm kinds", () => {
    for (const confirm of ["none", "hold", "hold_props_off"]) {
      expect(parseAction({ id: "a", label_key: "k", style: "danger", confirm })?.confirm).toBe(confirm);
    }
    expect(parseAction({ id: "a", label_key: "k", style: "danger", confirm: "maybe" })).toBeNull();
  });

  it("parses stream frames and ignores unknown kinds", () => {
    expect(parseFrame({ kind: "step", ts_ms: 1, data: accel })).not.toBeNull();
    expect(parseFrame({ kind: "bogus", ts_ms: 1, data: {} })).toBeNull();
  });

  it("reports setup needed only with a status in hand", () => {
    expect(setupNeeded(null)).toBe(false);
  });
});

describe("fc-setup URLs", () => {
  it("builds every route and escapes segments", () => {
    expect(fcSetupUrls.status()).toBe("/api/v1/fc-setup");
    expect(fcSetupUrls.start("ground")).toBe("/api/v1/fc-setup/ground/start");
    expect(fcSetupUrls.action("ground", "outputs", "answer_yes")).toBe("/api/v1/fc-setup/ground/steps/outputs/actions/answer_yes");
    expect(fcSetupUrls.run("air", "autotune")).toBe("/api/v1/fc-setup/air/steps/autotune/run");
    expect(fcSetupUrls.abort("air")).toBe("/api/v1/fc-setup/air/abort");
    expect(fcSetupUrls.action("a b", "c/d", "e")).toBe("/api/v1/fc-setup/a%20b/steps/c%2Fd/actions/e");
    expect(fcSetupUrls.stream({ protocol: "https:", host: "drone.local" })).toBe("wss://drone.local/api/v1/fc-setup/stream");
  });
});
