/**
 * The targets layer ages like every other layer: full alpha while the shown
 * detection batch is under 500 ms old, dimmed to 500 ms–2 s, hidden after 2 s
 * with the "Targets unavailable" chip.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LayerEngine } from "../engine";
import type { TargetScene, TargetStyle } from "../draw-targets";
import type { GlyphLayout } from "@/lib/vision/target-layout";
import type { CockpitMark } from "@/lib/cockpit/marks";

const STYLE: TargetStyle = {
  ink: "#fff",
  primary: "#0af",
  track: "#0f0",
  coast: "#ff0",
  crit: "#f00",
  warn: "#fa0",
  muted: "#888",
  gt: "#ccc",
  lead: "#0ff",
  glass: "#000",
  outlineColor: "#000",
  stroke: 2,
  outline: 1,
  tagFont: "Inter",
  tagWeight: "600",
  tagPad: 4,
};

interface Recorder {
  canvas: HTMLCanvasElement;
  calls: string[];
  alphas: number[];
  texts: string[];
}

function recorder(): Recorder {
  const calls: string[] = [];
  const alphas: number[] = [];
  const texts: string[] = [];
  const target: Record<string, unknown> = {
    canvas: null,
    getTransform: () => ({ a: 1, d: 1 }),
    measureText: () => ({ width: 40 }),
  };
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return (...args: unknown[]) => {
        calls.push(prop);
        if (prop === "fillText") texts.push(String(args[0]));
      };
    },
    set(_t, prop: string, value: unknown) {
      if (prop === "globalAlpha") alphas.push(Number(value));
      return true;
    },
  });
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  target.canvas = canvas;
  return { canvas, calls, alphas, texts };
}

const BOX_LAYOUT = {
  item: { kind: "TRACKED", modifiers: {} },
  key: "t1",
  kind: "TRACKED",
  box: { x: 100, y: 100, w: 80, h: 160 },
  brackets: "M0 0",
  topTag: null,
  bottomTags: [],
  reticle: null,
  feet: null,
  ring: null,
  arrow: null,
  hit: null,
  ghost: [],
  fontPx: 12,
} as unknown as GlyphLayout;

const MARK: CockpitMark = { id: "m1", kind: "point", x: 0.5, y: 0.5, space: "normalized" };

function scene(batchAt: number | null, detector = batchAt !== null, marks: CockpitMark[] = []): TargetScene {
  return { layouts: [BOX_LAYOUT], at: 1000, focusKey: null, reducedMotion: true, marks, markFrame: null, batchAt, detector };
}

beforeAll(() => {
  vi.stubGlobal(
    "Path2D",
    class {
      constructor(_d?: string) {}
    },
  );
});

describe("targets layer staleness", () => {
  let e: LayerEngine | null = null;
  afterEach(() => e?.detach());

  function setup(batchAt: number | null, detector = batchAt !== null, marks: CockpitMark[] = []): Recorder {
    const r = recorder();
    e = new LayerEngine(() => {});
    e.attach(r.canvas);
    e.setRunning(false);
    e.resize(1280, 720, 1);
    e.setOptions({
      droneId: "dt",
      cameraId: "main",
      level: "full",
      layers: new Set(["targets"]),
      depthMode: "solid",
      depthRange: "5",
      fpsCap: 0,
    });
    e.setStyle(STYLE);
    e.setTargets(scene(batchAt, detector, marks));
    r.calls.length = 0;
    r.alphas.length = 0;
    r.texts.length = 0;
    return r;
  }

  it("draws a batch under 500 ms old at full alpha, with no chip", () => {
    const r = setup(1000);
    e!.draw(1300);
    expect(r.calls).toContain("stroke");
    expect(Math.max(...r.alphas)).toBe(1);
    expect(r.texts).not.toContain("Targets unavailable");
  });

  it("dims a batch between 500 ms and 2 s old", () => {
    const r = setup(1000);
    e!.draw(1000 + 900);
    expect(r.calls).toContain("stroke");
    expect(r.alphas.length).toBeGreaterThan(0);
    expect(Math.max(...r.alphas)).toBeLessThan(1);
    expect(r.texts).not.toContain("Targets unavailable");
  });

  it("hides a batch older than 2 s and shows the unavailable chip", () => {
    const r = setup(1000);
    e!.draw(1000 + 2500);
    expect(r.calls).not.toContain("stroke");
    expect(r.texts).toContain("Targets unavailable");
  });

  it("shows the unavailable chip when a running detector has sent no batch", () => {
    const r = setup(null, true);
    e!.draw(5000);
    expect(r.calls).not.toContain("stroke");
    expect(r.texts).toContain("Targets unavailable");
  });

  it("shows no chip on a drone without a detector", () => {
    const r = setup(null, false);
    e!.draw(5000);
    expect(r.texts).not.toContain("Targets unavailable");
  });

  it("draws the cockpit marks with no detection batch", () => {
    const r = setup(null, false, [MARK]);
    e!.draw(5000);
    expect(r.calls).toContain("arc");
  });

  it("keeps drawing the cockpit marks after the batch goes stale", () => {
    const r = setup(1000, true, [MARK]);
    e!.draw(1000 + 2500);
    expect(r.calls).toContain("arc");
    expect(r.texts).toContain("Targets unavailable");
  });
});
