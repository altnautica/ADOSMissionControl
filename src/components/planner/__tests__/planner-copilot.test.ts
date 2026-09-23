/**
 * @module planner-copilot.test
 * @description Unit tests for the copilot's deterministic intent → action
 * mapping (`planCopilotActions`), including a couple of end-to-end passes
 * through `parseMissionIntent`.
 * @license GPL-3.0-only
 */
import { describe, it, expect, beforeEach } from "vitest";
import { applyCopilotPlan, planCopilotActions } from "@/components/planner/PlannerCopilot";
import { parseMissionIntent, type MissionIntent } from "@/lib/nl-intent-parser";
import { usePatternStore } from "@/stores/pattern-store";
import { CAMERA_PROFILES, computeLineSpacing, computeTriggerDistance } from "@/lib/patterns/gsd-calculator";

describe("planCopilotActions", () => {
  it("maps a survey pattern to the survey pattern type and is actionable", () => {
    const plan = planCopilotActions({ pattern: "survey" });
    expect(plan.patternType).toBe("survey");
    expect(plan.unsupportedPattern).toBeNull();
    expect(plan.actionable).toBe(true);
  });

  it("maps orbit and carries a radius", () => {
    const plan = planCopilotActions({ pattern: "orbit", radiusM: 80 });
    expect(plan.patternType).toBe("orbit");
    expect(plan.radiusM).toBe(80);
    expect(plan.actionable).toBe(true);
  });

  it("maps corridor", () => {
    const plan = planCopilotActions({ pattern: "corridor" });
    expect(plan.patternType).toBe("corridor");
    expect(plan.actionable).toBe(true);
  });

  it("flags perimeter as unsupported (no generator) and not actionable on its own", () => {
    const plan = planCopilotActions({ pattern: "perimeter" });
    expect(plan.patternType).toBeNull();
    expect(plan.unsupportedPattern).toBe("perimeter");
    expect(plan.actionable).toBe(false);
  });

  it("carries altitude / speed / overlap numeric fields and is actionable", () => {
    const plan = planCopilotActions({ altitudeM: 80, speedMps: 6, overlapPct: 75 });
    expect(plan.patternType).toBeNull();
    expect(plan.altitudeM).toBe(80);
    expect(plan.speedMps).toBe(6);
    expect(plan.overlapPct).toBe(75);
    expect(plan.actionable).toBe(true);
  });

  it("carries a place as a hint only, never actionable", () => {
    const plan = planCopilotActions({ place: "the north field" });
    expect(plan.patternType).toBeNull();
    expect(plan.place).toBe("the north field");
    expect(plan.actionable).toBe(false);
  });

  it("omits absent fields entirely", () => {
    const plan = planCopilotActions({ pattern: "survey" });
    expect(plan.altitudeM).toBeUndefined();
    expect(plan.speedMps).toBeUndefined();
    expect(plan.overlapPct).toBeUndefined();
    expect(plan.radiusM).toBeUndefined();
    expect(plan.place).toBeUndefined();
  });

  it("end-to-end: survey with altitude, overlap and speed", () => {
    const intent = parseMissionIntent("survey at 80m 75% overlap 6 m/s");
    expect(intent).not.toBeNull();
    const plan = planCopilotActions(intent as MissionIntent);
    expect(plan.patternType).toBe("survey");
    expect(plan.altitudeM).toBe(80);
    expect(plan.overlapPct).toBe(75);
    expect(plan.speedMps).toBe(6);
    expect(plan.actionable).toBe(true);
  });

  it("end-to-end: orbit with a radius", () => {
    const intent = parseMissionIntent("orbit with radius 120m");
    expect(intent).not.toBeNull();
    const plan = planCopilotActions(intent as MissionIntent);
    expect(plan.patternType).toBe("orbit");
    expect(plan.radiusM).toBe(120);
    expect(plan.actionable).toBe(true);
  });
});

describe("applyCopilotPlan", () => {
  const camera = CAMERA_PROFILES[0];

  beforeEach(() => {
    usePatternStore.getState().setPatternType("survey");
    usePatternStore.getState().updateSurveyConfig({
      altitude: 50,
      lineSpacing: computeLineSpacing(50, camera, 0.7),
      cameraTriggerDistance: computeTriggerDistance(50, camera, 0.8),
      _cameraName: camera.name,
      _sidelap: 70,
      _frontlap: 80,
    } as Record<string, unknown>);
  });

  it("keeps the stored overlap true when only the altitude changes", () => {
    applyCopilotPlan(planCopilotActions(parseMissionIntent("survey at 25m") as MissionIntent));
    const cfg = usePatternStore.getState().surveyConfig as Record<string, number>;
    expect(cfg.altitude).toBe(25);
    expect(cfg.lineSpacing).toBeCloseTo(computeLineSpacing(25, camera, 0.7), 1);
    expect(cfg.cameraTriggerDistance).toBeCloseTo(computeTriggerDistance(25, camera, 0.8), 1);
    expect(cfg._sidelap).toBe(70);
    expect(cfg._frontlap).toBe(80);
  });
});
