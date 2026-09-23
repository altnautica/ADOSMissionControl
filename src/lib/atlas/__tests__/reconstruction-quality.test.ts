import { describe, it, expect } from "vitest";
import {
  RECONSTRUCTION_QUALITIES,
  DEFAULT_QUALITY_ID,
  DEFAULT_RECONSTRUCTION_STEPS,
  qualityById,
  stepsForQuality,
  qualityForSteps,
} from "../reconstruction-quality";

describe("reconstruction-quality presets", () => {
  it("has the four levels in coarse→fine order", () => {
    expect(RECONSTRUCTION_QUALITIES.map((q) => q.id)).toEqual([
      "draft",
      "standard",
      "high",
      "maximum",
    ]);
    expect(RECONSTRUCTION_QUALITIES.map((q) => q.steps)).toEqual([
      7000, 15000, 30000, 50000,
    ]);
  });

  it("bundles a gaussian-count cap + SH degree that grow with the level", () => {
    // maxSplats must strictly increase (finer = bigger budget); the cap is the
    // primary speed lever, so every level must carry a real (non-zero) bound.
    const caps = RECONSTRUCTION_QUALITIES.map((q) => q.maxSplats);
    expect(caps).toEqual([600_000, 1_000_000, 1_500_000, 2_500_000]);
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]).toBeGreaterThan(caps[i - 1]);
    }
    // Draft trades a little view-dependent colour for speed; the rest keep SH 3.
    expect(RECONSTRUCTION_QUALITIES.map((q) => q.shDegree)).toEqual([2, 3, 3, 3]);
    for (const q of RECONSTRUCTION_QUALITIES) {
      expect(q.shDegree).toBeGreaterThanOrEqual(0);
      expect(q.shDegree).toBeLessThanOrEqual(3);
    }
  });

  it("defaults to high / 30k", () => {
    expect(DEFAULT_QUALITY_ID).toBe("high");
    expect(DEFAULT_RECONSTRUCTION_STEPS).toBe(30000);
    expect(stepsForQuality(DEFAULT_QUALITY_ID)).toBe(30000);
  });

  it("maps id → steps", () => {
    expect(stepsForQuality("draft")).toBe(7000);
    expect(stepsForQuality("standard")).toBe(15000);
    expect(stepsForQuality("high")).toBe(30000);
    expect(stepsForQuality("maximum")).toBe(50000);
  });

  it("falls back to high for an unknown id", () => {
    expect(qualityById("nonsense").id).toBe("high");
    expect(stepsForQuality("nonsense")).toBe(30000);
  });

  it("decodes exact step counts back to their level", () => {
    expect(qualityForSteps(7000).id).toBe("draft");
    expect(qualityForSteps(15000).id).toBe("standard");
    expect(qualityForSteps(30000).id).toBe("high");
    expect(qualityForSteps(50000).id).toBe("maximum");
  });

  it("snaps an arbitrary count to the nearest level", () => {
    expect(qualityForSteps(8000).id).toBe("draft"); // 1k vs 7k
    expect(qualityForSteps(22000).id).toBe("standard"); // 7k vs 8k
    expect(qualityForSteps(23000).id).toBe("high"); // 8k vs 7k
    expect(qualityForSteps(1).id).toBe("draft");
    expect(qualityForSteps(1_000_000).id).toBe("maximum");
  });

  it("breaks a distance tie toward the finer level", () => {
    // 22500 is equidistant from standard (15k) and high (30k) → finer wins.
    expect(qualityForSteps(22500).id).toBe("high");
  });
});
