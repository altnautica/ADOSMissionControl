/**
 * The cockpit layer stack's data path: the nav-frame parsers on the agent's golden
 * wire fixtures (copied byte for byte), the nav-stream routing of the overlay
 * kinds into the mutable frame store, the view lease merge/renew/release, the
 * level rules from the cockpit spec, and the draw loop's change-driven
 * behaviour against a recording 2D context.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import arFixture from "../fixtures/ar-frame.json";
import depthFixture from "../fixtures/depth-frame.json";
import obstaclesFixture from "../fixtures/obstacles-frame.json";
import pilotFixture from "../fixtures/pilot-frame.json";
import surfacesFixture from "../fixtures/surfaces-frame.json";
import {
  decodeBase64Into,
  decodeGridCode,
  parseObstaclesFrame,
  parsePilotState,
  parseArFrame,
  parseDepthFrame,
  parseSurfacesFrame,
} from "@/lib/hud/cockpit-frames";
import { clearFrames, frameVersion, getFrames, putFrame } from "../frame-store";
import { effectiveLayers } from "../layer-spec";
import { holdViewLease, setViewLeaseSender, viewDemand } from "../view-lease";
import { LayerEngine } from "../engine";
import { ingestNavFrame, parseNavFrame } from "@/lib/agent/nav-stream";
import { useNavStreamStore } from "@/stores/nav-stream-store";

describe("nav-frame parsers on the golden fixtures", () => {
  it("parses the ar frame with keys, mission and every item type", () => {
    const f = parseArFrame(arFixture);
    expect(f).not.toBeNull();
    const cam = f!.cameras.main;
    expect(cam.frameW).toBe(1280);
    expect(cam.items.map((i) => i.k)).toEqual([
      "wp:4",
      "wp:5",
      "leg:active",
      "leg:next",
      "home",
      "fpv",
      "fpath",
      "fgoal",
      "orbit",
      "edge:home",
    ]);
    expect(f!.mission?.state).toBe("active");
    expect(f!.mission?.seq).toBe(4);
  });

  it("decodes the depth grid's log codes and measured mask", () => {
    const d = parseDepthFrame(depthFixture);
    expect(d).not.toBeNull();
    const g = d!.cameras.main;
    expect(g.cols * g.rows).toBe(576);
    const near = new Uint8Array(576);
    expect(decodeBase64Into(g.near, near)).toBe(576);
    expect(decodeGridCode(0)).toBeNull();
    expect(decodeGridCode(1)).toBeCloseTo(0.2, 6);
    expect(decodeGridCode(255)).toBeCloseTo(60, 3);
  });

  it("parses the surfaces zones", () => {
    const s = parseSurfacesFrame(surfacesFixture);
    expect(s?.cameraId).toBe("main");
    expect(s?.zones).toHaveLength(2);
    expect(s?.zones[0].score).toBeCloseTo(0.82);
  });

  it("parses the obstacles frame: 72 sectors and the per-camera grid", () => {
    const o = parseObstaclesFrame(obstaclesFixture);
    expect(o).not.toBeNull();
    expect(o!.sectorsM).toHaveLength(72);
    expect(o!.sectorsM[0]).toBeCloseTo(3.1);
    expect(o!.sectorsM[3]).toBeNull();
    const g = Object.values(o!.cameras)[0];
    expect(g.cols * g.rows).toBe(576);
  });

  it("parses the pilot frame with the mission and the flight-flow fields", () => {
    const p = parsePilotState(pilotFixture);
    expect(p).not.toBeNull();
    expect(p!.owner).toBe("skill");
    expect(p!.avoidState).toBe("detour");
    expect(p!.planNed).toHaveLength(4);
    expect(p!.mission?.state).toBe("none");
    expect(p!.inputSession).toEqual({ src: "mc", label: "Mission Control", session: 7 });
    expect(p!.banner?.textKey).toBe("pilot.banner.ados_engaged");
    expect(p!.vehicleClass).toBe("multirotor");
  });

  it("parses the surface ops, height above ground and FC warnings", () => {
    const p = parsePilotState(pilotFixture)!;
    expect(p.surfaceOps).toEqual(["goto"]);
    expect(p.aglM).toBe(4.2);
    expect(p.aglSource).toBe("rangefinder");
    expect(p.statustext).toEqual([{ severity: 4, text: "PreArm: Compass not calibrated", ageMs: 1200 }]);
  });
});

describe("nav-stream routing", () => {
  afterEach(() => {
    clearFrames("d1");
    useNavStreamStore.getState().clear("d1");
  });

  it("puts overlay kinds in the frame store, not in React state", () => {
    const before = useNavStreamStore.getState().byDrone;
    const v0 = frameVersion();
    const frame = parseNavFrame({ kind: "ar", ts_ms: 1, data: arFixture });
    expect(frame?.kind).toBe("ar");
    ingestNavFrame("d1", frame!, 1000);
    expect(frameVersion()).toBe(v0 + 1);
    expect(getFrames("d1").ar?.frame.cameras.main.items).toHaveLength(10);
    expect(useNavStreamStore.getState().byDrone).toBe(before);
  });

  it("stores the pilot kind in the nav store", () => {
    const frame = parseNavFrame({
      kind: "pilot",
      ts_ms: 1,
      data: { owner: "pilot", armed: true, landed: false, plan_ned: [], readiness: [] },
    });
    expect(frame?.kind).toBe("pilot");
    ingestNavFrame("d1", frame!, 5);
    expect(useNavStreamStore.getState().byDrone.d1?.pilot?.data.owner).toBe("pilot");
    expect(useNavStreamStore.getState().byDrone.d1?.pilot?.receivedAt).toBe(5);
  });
});

describe("frame store", () => {
  afterEach(() => clearFrames("d2"));

  it("keeps the previous frame for interpolation and treats a repeat ts as keep-alive", () => {
    const a = parseArFrame({ ...arFixture, ts_ms: 1 })!;
    const b = parseArFrame({ ...arFixture, ts_ms: 2 })!;
    putFrame("d2", "ar", a, 100);
    putFrame("d2", "ar", b, 150);
    const slot = getFrames("d2").ar!;
    expect(slot.prev).toBe(a);
    expect(slot.prevAt).toBe(100);
    putFrame("d2", "ar", parseArFrame({ ...arFixture, ts_ms: 2 })!, 900);
    expect(slot.frame).toBe(b);
    expect(slot.receivedAt).toBe(900);
    // The keep-alive must not restart interpolation.
    expect(slot.frameAt).toBe(150);
    expect(slot.prevAt).toBe(100);
    expect(slot.prev).toBe(a);
    const c = parseArFrame({ ...arFixture, ts_ms: 3 })!;
    putFrame("d2", "ar", c, 1000);
    expect(slot.prev).toBe(b);
    expect(slot.prevAt).toBe(150);
    expect(slot.frameAt).toBe(1000);
  });
});

describe("view lease", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    setViewLeaseSender("d3", null);
    vi.useRealTimers();
  });

  it("merges holders per camera, renews every 2 s and releases once nothing is watched", () => {
    const sent: unknown[] = [];
    setViewLeaseSender("d3", (t) => sent.push(JSON.parse(t)));
    const a = holdViewLease("d3", "main", ["ar_route", "obstacles"]);
    const b = holdViewLease("d3", "main", ["ar_motion"]);
    expect(viewDemand("d3").get("main")).toEqual(["ar_route", "ar_motion", "obstacles"]);
    expect(sent.at(-1)).toEqual({ type: "view", camera_id: "main", layers: ["ar_route", "ar_motion", "obstacles"] });
    const n = sent.length;
    vi.advanceTimersByTime(2000);
    expect(sent.length).toBe(n + 1);
    b.update("down", ["depth"]);
    expect(sent).toContainEqual({ type: "view", camera_id: "down", layers: ["depth"] });
    a.release();
    // One lease per socket: the "down" frame already superseded "main".
    expect(sent).not.toContainEqual({ type: "view", camera_id: "main", layers: [] });
    b.release();
    expect(sent.at(-1)).toEqual({ type: "view", camera_id: "down", layers: [] });
    const m = sent.length;
    vi.advanceTimersByTime(6000);
    expect(sent.length).toBe(m);
  });

  it("sends the whole demand to a reopened socket", () => {
    const h = holdViewLease("d3", "main", ["obstacles"]);
    const sent: string[] = [];
    setViewLeaseSender("d3", (t) => sent.push(t));
    expect(sent).toEqual([JSON.stringify({ type: "view", camera_id: "main", layers: ["obstacles"] })]);
    h.release();
  });
});

describe("level rules (cockpit spec layers.json)", () => {
  it("Instruments draws every default layer, Full all but the instruments, Route the route list, Off the centre marks", () => {
    expect([...effectiveLayers("instruments", {}, "pilot")].sort()).toEqual(
      ["ar_motion", "ar_route", "centre_marks", "instruments", "obstacles", "targets"].sort(),
    );
    expect([...effectiveLayers("full", {}, "pilot")].sort()).toEqual(
      ["ar_motion", "ar_route", "centre_marks", "obstacles", "targets"].sort(),
    );
    expect([...effectiveLayers("route", {}, "pilot")].sort()).toEqual(
      ["ar_motion", "ar_route", "centre_marks", "obstacles", "targets"].sort(),
    );
    expect([...effectiveLayers("off", {}, "pilot")]).toEqual(["centre_marks"]);
    // The instruments never draw outside Instruments, flip or not.
    expect(effectiveLayers("full", { instruments: true }, "pilot").has("instruments")).toBe(false);
  });

  it("leased layers ignore the level; a flip or the vision view turns them on", () => {
    expect(effectiveLayers("full", {}, "pilot").has("depth")).toBe(false);
    expect(effectiveLayers("off", { depth: true }, "pilot").has("depth")).toBe(true);
    const vision = effectiveLayers("off", {}, "vision");
    expect(vision.has("depth") && vision.has("surfaces") && vision.has("targets")).toBe(true);
    expect(effectiveLayers("full", { obstacles: false }, "pilot").has("obstacles")).toBe(false);
  });
});

/** A 2D context that records the calls the painter makes. */
function recordingCanvas(): { canvas: HTMLCanvasElement; calls: string[] } {
  const calls: string[] = [];
  const target: Record<string, unknown> = {
    canvas: null,
    getTransform: () => ({ a: 1, d: 1 }),
    measureText: () => ({ width: 40 }),
  };
  const ctx = new Proxy(
    target,
    {
      get(target, prop: string) {
        if (prop in target) return (target as Record<string, unknown>)[prop];
        return (..._args: unknown[]) => {
          calls.push(prop);
        };
      },
      set() {
        return true;
      },
    },
  );
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  target.canvas = canvas;
  return { canvas, calls };
}

describe("draw loop", () => {
  afterEach(() => clearFrames("d4"));

  function engine(): { e: LayerEngine; calls: string[] } {
    const { canvas, calls } = recordingCanvas();
    const e = new LayerEngine(() => {});
    e.attach(canvas);
    e.setRunning(false);
    e.resize(1280, 720, 1);
    e.setOptions({
      droneId: "d4",
      cameraId: "main",
      level: "full",
      layers: new Set(["ar_route", "ar_motion", "obstacles"]),
      depthMode: "solid",
      depthRange: "5",
      fpsCap: 0,
    });
    return { e, calls };
  }

  it("paints nothing without frames and paints the AR route with one", () => {
    const { e, calls } = engine();
    e.draw(1000);
    expect(calls.filter((c) => c === "stroke").length).toBe(0);
    putFrame("d4", "ar", parseArFrame(arFixture)!, 1000);
    e.draw(1000);
    expect(calls.filter((c) => c === "stroke").length).toBeGreaterThan(0);
    e.detach();
  });

  it("hides a layer whose frame is older than 2 s", () => {
    const { e, calls } = engine();
    putFrame("d4", "ar", parseArFrame(arFixture)!, 1000);
    calls.length = 0;
    e.draw(1000 + 2500);
    // Only the "AR unavailable" chip is painted (a fill, no route strokes).
    expect(calls.filter((c) => c === "stroke").length).toBe(0);
    expect(calls).toContain("fillText");
    e.detach();
  });

  it("interpolates between the last two frames and stops animating once done", () => {
    const { e } = engine();
    putFrame("d4", "ar", parseArFrame({ ...arFixture, ts_ms: 1 })!, 1000);
    putFrame("d4", "ar", parseArFrame({ ...arFixture, ts_ms: 2 })!, 1050);
    expect(e.draw(1060)).toBe(true);
    expect(e.draw(1300)).toBe(false);
    e.detach();
  });
});
