import { describe, expect, it } from "vitest";

import {
  advanceBoxes,
  boxDistance,
  easeBox,
  smoothingAlpha,
  type SmoothBox,
} from "../box-smoothing";

describe("smoothingAlpha", () => {
  it("is 0 when no time has elapsed (box holds still)", () => {
    expect(smoothingAlpha(0, 120)).toBe(0);
    expect(smoothingAlpha(-16, 120)).toBe(0);
  });

  it("snaps (alpha 1) when the time-constant is zero or negative", () => {
    expect(smoothingAlpha(16, 0)).toBe(1);
    expect(smoothingAlpha(16, -1)).toBe(1);
  });

  it("closes ~63% of the gap over one time-constant", () => {
    // alpha = 1 - e^-1 ≈ 0.632 when dt == tau.
    expect(smoothingAlpha(120, 120)).toBeCloseTo(1 - Math.exp(-1), 4);
  });

  it("approaches 1 for a long gap and stays within [0,1]", () => {
    const a = smoothingAlpha(2000, 120);
    expect(a).toBeGreaterThan(0.99);
    expect(a).toBeLessThanOrEqual(1);
  });

  it("is frame-rate independent — two half-steps ≈ one full step", () => {
    const tau = 120;
    const full = smoothingAlpha(16, tau);
    // Composing two 8ms eases must close the same fraction as one 16ms ease.
    const half = smoothingAlpha(8, tau);
    const composed = 1 - (1 - half) * (1 - half);
    expect(composed).toBeCloseTo(full, 6);
  });
});

describe("easeBox", () => {
  const current: SmoothBox = { x: 0, y: 0, width: 100, height: 100 };
  const target: SmoothBox = { x: 40, y: 20, width: 60, height: 80 };

  it("moves each field toward the target without overshooting", () => {
    const next = easeBox(current, target, 0.25);
    // Each field lands strictly between current and target (no overshoot).
    expect(next.x).toBeGreaterThan(0);
    expect(next.x).toBeLessThan(40);
    expect(next.y).toBeGreaterThan(0);
    expect(next.y).toBeLessThan(20);
    // A shrinking dimension moves down, never below the target.
    expect(next.width).toBeLessThan(100);
    expect(next.width).toBeGreaterThan(60);
    expect(next.height).toBeLessThan(100);
    expect(next.height).toBeGreaterThan(80);
  });

  it("lands exactly on the target at alpha=1 (no overshoot past it)", () => {
    expect(easeBox(current, target, 1)).toEqual(target);
  });

  it("stays put at alpha=0", () => {
    expect(easeBox(current, target, 0)).toEqual(current);
  });
});

describe("boxDistance", () => {
  it("is the largest per-field absolute difference", () => {
    const a: SmoothBox = { x: 0, y: 0, width: 100, height: 100 };
    const b: SmoothBox = { x: 3, y: -5, width: 100, height: 88 };
    // max(|0-3|, |0-(-5)|, |100-100|, |100-88|) = max(3,5,0,12) = 12.
    expect(boxDistance(a, b)).toBe(12);
    expect(boxDistance(a, a)).toBe(0);
  });
});

describe("critically-damped convergence over a frame sequence", () => {
  it("converges monotonically toward the latest target and never overshoots", () => {
    const tau = 120;
    const dt = 16; // ~60 fps
    const start: SmoothBox = { x: 0, y: 0, width: 50, height: 50 };
    const target: SmoothBox = { x: 200, y: 120, width: 90, height: 70 };

    // No-overshoot: each field must stay bounded between its start and target.
    const within = (v: number, a: number, b: number) =>
      v >= Math.min(a, b) - 1e-9 && v <= Math.max(a, b) + 1e-9;

    let box = start;
    let prevDist = boxDistance(box, target);
    for (let i = 0; i < 120; i++) {
      box = easeBox(box, target, smoothingAlpha(dt, tau));
      const dist = boxDistance(box, target);
      // The gap shrinks every frame (monotonic, no oscillation).
      expect(dist).toBeLessThanOrEqual(prevDist + 1e-9);
      prevDist = dist;
      // Every field stays between where it started and its target (no overshoot).
      expect(within(box.x, start.x, target.x)).toBe(true);
      expect(within(box.y, start.y, target.y)).toBe(true);
      expect(within(box.width, start.width, target.width)).toBe(true);
      expect(within(box.height, start.height, target.height)).toBe(true);
    }
    // After ~2s of frames the box has effectively arrived.
    expect(boxDistance(box, target)).toBeLessThan(0.5);
  });

  it("re-targets to the newest box mid-flight and converges there", () => {
    const tau = 120;
    const dt = 16;
    let box: SmoothBox = { x: 0, y: 0, width: 40, height: 40 };
    // Ease part-way toward the first target...
    const first: SmoothBox = { x: 100, y: 100, width: 40, height: 40 };
    for (let i = 0; i < 5; i++) box = easeBox(box, first, smoothingAlpha(dt, tau));
    expect(box.x).toBeGreaterThan(0);
    expect(box.x).toBeLessThan(100);
    // ...then a fresh batch moves the target; the box follows the latest.
    const second: SmoothBox = { x: 250, y: 60, width: 40, height: 40 };
    for (let i = 0; i < 120; i++)
      box = easeBox(box, second, smoothingAlpha(dt, tau));
    expect(boxDistance(box, second)).toBeLessThan(0.5);
  });
});

describe("advanceBoxes", () => {
  const target = { x: 100, y: 100, width: 50, height: 50 };

  it("keeps running while a box is still easing and settles once it lands", () => {
    const displayed = new Map([["cam:1", { x: 0, y: 0, width: 50, height: 50 }]]);
    const targets = new Map([["cam:1", target]]);
    const moving = advanceBoxes(displayed, targets, 0.5, 0.5);
    expect(moving.settled).toBe(false);
    const landed = advanceBoxes(moving.next, targets, 1, 0.5);
    expect(landed.settled).toBe(true);
    expect(landed.next.get("cam:1")).toEqual(target);
  });

  it("is settled with nothing to draw, returning the same map", () => {
    const displayed = new Map<string, typeof target>();
    const step = advanceBoxes(displayed, new Map(), 0.5, 0.5);
    expect(step.settled).toBe(true);
    expect(step.next).toBe(displayed);
  });

  it("drops a box whose track left and settles", () => {
    const displayed = new Map([["cam:1", target]]);
    const step = advanceBoxes(displayed, new Map(), 0.5, 0.5);
    expect(step.next.size).toBe(0);
    expect(step.settled).toBe(true);
  });
});
