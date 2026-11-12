/**
 * Letting go of part of a safety chord aborts it: the arm hold (L1 + R1) and
 * the emergency stop (L2 + R2 + Circle) fire only while every control of the
 * chord stays down for the whole hold.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { GestureEngine } from "@/lib/input/ds4-bindings";
import { effectiveBindings } from "@/stores/controls-store";

/** Each step: the controls down and the time, in ms. Returns the fired actions. */
function run(steps: readonly [readonly string[], number][]): { fired: string[]; progressEnded: string[] } {
  const fired: string[] = [];
  const progressEnded: string[] = [];
  const engine = new GestureEngine(effectiveBindings({ bindings: null }), {
    when: () => true,
    fire: (b) => fired.push(b.action),
    holdProgress: (b, p) => {
      if (p === null) progressEnded.push(b.action);
    },
  });
  for (const [down, t] of steps) engine.update((c) => down.includes(c), t);
  return { fired, progressEnded };
}

/** Sample every 100 ms from `from` to `to` with the same controls down. */
function holdFor(down: readonly string[], from: number, to: number): [readonly string[], number][] {
  const out: [readonly string[], number][] = [];
  for (let t = from; t <= to; t += 100) out.push([down, t]);
  return out;
}

describe("safety chord break", () => {
  it("arms when L1 + R1 are held for the whole hold", () => {
    expect(run(holdFor(["l1", "r1"], 0, 2200)).fired).toContain("arm");
  });

  it("does not arm when R1 is let go part way, L1 still held", () => {
    const { fired, progressEnded } = run([
      ...holdFor(["l1", "r1"], 0, 400),
      ...holdFor(["l1"], 500, 3000),
      [[], 3100],
    ]);
    expect(fired).not.toContain("arm");
    expect(progressEnded).toContain("arm");
  });

  it("does not stop the motors when L2 + R2 are let go part way, Circle still held", () => {
    const { fired, progressEnded } = run([
      ...holdFor(["l2", "r2", "circle"], 0, 800),
      ...holdFor(["circle"], 900, 4000),
      [[], 4100],
    ]);
    expect(fired).not.toContain("kill");
    expect(progressEnded).toContain("kill");
  });

  it("does not stop the motors when one trigger is let go part way", () => {
    const { fired } = run([
      ...holdFor(["l2", "r2", "circle"], 0, 800),
      ...holdFor(["l2", "circle"], 900, 4000),
      [[], 4100],
    ]);
    expect(fired).not.toContain("kill");
  });
});
