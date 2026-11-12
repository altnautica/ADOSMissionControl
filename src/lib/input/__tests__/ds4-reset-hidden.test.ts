/**
 * A press the surface stops seeing (tab hidden, pad lost) never completes:
 * after `reset`, releasing the control fires neither its tap nor its hold.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { GestureEngine } from "@/lib/input/ds4-bindings";
import { effectiveBindings } from "@/stores/controls-store";

function engineWith(fired: string[], ended: string[]): GestureEngine {
  return new GestureEngine(effectiveBindings({ bindings: null }), {
    when: () => true,
    fire: (b) => fired.push(b.action),
    holdProgress: (b, p) => {
      if (p === null) ended.push(b.action);
    },
  });
}

describe("gesture engine reset", () => {
  it("drops a held tap press without firing it", () => {
    const fired: string[] = [];
    const engine = engineWith(fired, []);
    engine.update((c) => c === "options", 0);
    engine.reset();
    engine.update(() => false, 100);
    engine.update(() => false, 10_000);
    expect(fired).toEqual([]);
  });

  it("drops a combo hold in progress and ends its progress", () => {
    const fired: string[] = [];
    const ended: string[] = [];
    const engine = engineWith(fired, ended);
    engine.update((c) => c === "options", 0);
    engine.update((c) => c === "options" || c === "circle", 50);
    engine.update((c) => c === "options" || c === "circle", 300);
    const before = [...fired];
    engine.reset();
    engine.update(() => false, 400);
    engine.update(() => false, 10_000);
    expect(fired).toEqual(before);
    expect(ended.length).toBeGreaterThan(0);
  });

  it("reads a control still down after a reset as a fresh press", () => {
    const fired: string[] = [];
    const engine = engineWith(fired, []);
    engine.update((c) => c === "options", 0);
    engine.reset();
    engine.update((c) => c === "options", 100);
    engine.update(() => false, 200);
    engine.update(() => false, 10_000);
    expect(fired).toEqual(["quick_settings"]);
  });
});
