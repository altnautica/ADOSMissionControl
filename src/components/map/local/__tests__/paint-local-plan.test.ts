/** The local-frame map's planned path: freshness and paint colours. */

import { describe, expect, it } from "vitest";

import { paintPlan, type LocalSceneColours } from "@/components/map/local/paint-local-scene";
import { framePlan } from "@/components/map/local/use-local-frame-data";
import tokens from "@/lib/cockpit-spec/tokens.json";
import { parsePilotState } from "@/lib/hud/cockpit-frames";

const colours: LocalSceneColours = {
  ink: "#fff",
  primary: "#00f",
  track: "#0f0",
  coast: "#888",
  hair: "#333",
  muted: "#999",
  glass: "#000",
  mono: "monospace",
};

/** A canvas stand-in that records each stroke's colour, dash and geometry. */
function recorder() {
  const strokes: Array<{ colour: string; dash: number[]; path: string[] }> = [];
  let path: string[] = [];
  let dash: number[] = [];
  const ctx = {
    strokeStyle: "",
    lineWidth: 1,
    lineJoin: "miter",
    setLineDash: (d: number[]) => {
      dash = d;
    },
    beginPath: () => {
      path = [];
    },
    moveTo: (x: number, y: number) => path.push(`M${x},${y}`),
    lineTo: (x: number, y: number) => path.push(`L${x},${y}`),
    arc: (x: number, y: number, r: number) => path.push(`A${x},${y},${r}`),
    stroke() {
      strokes.push({ colour: String(this.strokeStyle), dash, path: [...path] });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes };
}

describe("local map plan", () => {
  it("strokes the path dashed in state.goto and rings the goal", () => {
    const { ctx, strokes } = recorder();
    paintPlan(ctx, { points: [[100, 100], [100, 50]], goal: [100, 50], blocked: false }, colours);
    const coloured = strokes.filter((s) => s.colour === tokens.state.goto);
    expect(coloured).toHaveLength(2);
    expect(coloured[0]).toEqual({ colour: tokens.state.goto, dash: [5, 4], path: ["M100,100", "L100,50"] });
    expect(coloured[1].path).toEqual(["A100,50,5"]);
    expect(coloured[1].dash).toEqual([]);
  });

  it("turns state.blocked while the pilot reports blocked", () => {
    const { ctx, strokes } = recorder();
    paintPlan(ctx, { points: [], goal: [10, 10], blocked: true }, colours);
    expect(strokes.filter((s) => s.colour === tokens.state.blocked)).toHaveLength(1);
    expect(strokes.some((s) => s.colour === tokens.state.goto)).toBe(false);
  });

  it("keeps a go-to the planner holds blocked on the map, in state.blocked", () => {
    // The frame the pilot sends while a wall blocks a go-to: the commanded
    // goal and the straight way to it, with the avoid state blocked.
    const data = parsePilotState({
      owner: "goto",
      avoid_state: "blocked",
      hold_reason: "blocked",
      goal_ned: [20, 0, -5],
      plan_ned: [[0, 0], [20, 0]],
    })!;
    const plan = framePlan({ data, receivedAt: 1_000 }, 1_500);
    expect(plan).toEqual({ points: [[0, 0], [20, 0]], goal: [20, 0], blocked: true });
    const { ctx, strokes } = recorder();
    paintPlan(ctx, { points: [[100, 100], [100, 0]], goal: [100, 0], blocked: plan!.blocked }, colours);
    expect(strokes.filter((s) => s.colour === tokens.state.blocked)).toHaveLength(2);
    expect(strokes.some((s) => s.colour === tokens.state.goto)).toBe(false);
  });

  it("takes the plan from a fresh pilot frame only", () => {
    const data = parsePilotState({ owner: "goto", plan_ned: [[0, 0], [5, 0]], goal_ned: [5, 0, -5], avoid_state: "clear" })!;
    expect(framePlan({ data, receivedAt: 1_000 }, 1_500)).toEqual({ points: [[0, 0], [5, 0]], goal: [5, 0], blocked: false });
    expect(framePlan({ data, receivedAt: 1_000 }, 4_000)).toBeNull();
    expect(framePlan(undefined, 0)).toBeNull();
  });
});
