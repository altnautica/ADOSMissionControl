import { readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { fetchSetupStatus, rerunStep, runStepAction, setupErrorKey, startWizard } from "../client";
import { currentStep } from "../parse";
import { SETUP_IMAGES, optionText, setupImageUrl, setupText } from "../strings";
import { demoSetupTransport, resetDemoSetup } from "@/mock/mock-fc-setup";
import type { SetupFrame } from "../types";

describe("setup strings and pictures", () => {
  it("bundles every picture the cockpit spec ships", () => {
    const dir = join(process.cwd(), "src/lib/cockpit-spec/setup-images");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".svg"))
      .map((f) => f.slice(0, -4))
      .sort();
    expect(Object.keys(SETUP_IMAGES).sort()).toEqual(files);
    expect(setupImageUrl("accel_level")).toBeTruthy();
    expect(setupImageUrl("no_such_picture")).toBeNull();
  });

  it("fills placeholders and shows an unknown key as itself", () => {
    expect(setupText("setup.question.motor_position", { n: 3 })).toContain("3");
    expect(setupText("setup.nope")).toBe("setup.nope");
  });

  it("falls back from a body variant to the step body, and only there", () => {
    expect(setupText("setup.accel.body.no_such_phase")).toBe(setupText("setup.accel.body"));
    expect(setupText("setup.accel.title.no_such_phase")).toBe("setup.accel.title.no_such_phase");
  });

  it("labels a bare enum option by the engine's <input key>.<value> convention", () => {
    expect(optionText("setup.input.chemistry", "lipo", null)).toBe("LiPo");
    expect(optionText("setup.input.cells", 4, null)).toBe("4");
    expect(optionText("setup.input.chemistry", "lipo", "setup.input.chemistry.liion")).toBe("Li-ion");
  });
});

describe("demo setup engine", () => {
  afterEach(() => resetDemoSetup());

  it("walks the accelerometer poses to done and moves to the next step", async () => {
    const t = demoSetupTransport("demo-test");
    const before = await fetchSetupStatus(t);
    expect(before.uid).toBeTruthy();
    const ground = await startWizard(t, "ground");
    expect(ground.state).toBe("running");
    expect(currentStep(ground)?.step).toBe("accel");
    let step = currentStep(ground)!;
    for (let i = 0; i < 6; i++) step = await runStepAction(t, "ground", "accel", "next_pose");
    expect(step.state).toBe("done");
    const after = await fetchSetupStatus(t);
    expect(after.running).toEqual({ wizard: "ground", step: "level" });
  });

  it("streams parsed frames: the finished step, then the next unfinished one", async () => {
    const t = demoSetupTransport("demo-test");
    const frames: unknown[] = [];
    const stop = t.openStream((f) => frames.push(f));
    await startWizard(t, "ground");
    await runStepAction(t, "ground", "level", "start");
    stop();
    const steps = frames.filter((f): f is { kind: "step"; data: { step: string; inputs: unknown[] } } => (f as { kind: string }).kind === "step");
    // Level finishes out of order; the engine returns to the unfinished accel step.
    expect(steps.map((f) => f.data.step)).toEqual(["level", "accel"]);
    for (const f of steps) expect(Array.isArray(f.data.inputs)).toBe(true);
  });

  it("refuses an air step before the ground wizard with the engine's key", async () => {
    const t = demoSetupTransport("demo-test");
    const err = await rerunStep(t, "air", "autotune").catch((e: unknown) => e);
    expect(setupErrorKey(err)).toBe("setup.blocker.ground_required");
  });

  it("asks the motor question once the props-off test starts", async () => {
    const t = demoSetupTransport("demo-test");
    await rerunStep(t, "ground", "outputs");
    const step = await runStepAction(t, "ground", "outputs", "test");
    expect(step.live.question_key).toBe("setup.question.motor_position");
    expect(step.actions.map((a) => a.id)).toEqual(["answer_yes", "answer_no"]);
  });

  it("streams the air wizard as available once the ground wizard completes", async () => {
    const t = demoSetupTransport("demo-test");
    const frames: SetupFrame[] = [];
    const stop = t.openStream((f) => frames.push(f));
    let wizard = await startWizard(t, "ground");
    for (let guard = 0; guard < 20; guard++) {
      const step = currentStep(wizard);
      if (!step) break;
      await runStepAction(t, "ground", step.step, "done");
      wizard = (await fetchSetupStatus(t)).wizards.find((w) => w.id === "ground")!;
    }
    stop();
    expect(wizard.state).toBe("done");
    const air = frames.flatMap((f) => (f.kind === "wizard" && f.data.id === "air" ? [f.data] : []));
    expect(air.at(-1)?.available).toBe(true);
    expect(air.at(-1)?.blockers).toEqual([]);
  });
});
