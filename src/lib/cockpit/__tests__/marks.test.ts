import { beforeEach, describe, expect, it } from "vitest";

import {
  mapPoint,
  mapScale,
  parseCockpitMarks,
  MAX_MARKS_PER_SOURCE,
  MAX_LABEL_CHARS,
  MAX_POINTS_PER_POLYLINE,
  MAX_POINTS_PER_SOURCE,
  type MarkFrame,
} from "@/lib/cockpit/marks";
import { useCockpitMarksStore } from "@/stores/cockpit-marks-store";

const FRAME: MarkFrame = {
  // A 1280x720 detection frame letterboxed into an 800x600 container: the video
  // is pillarboxed to 800x450, centered (top = 75).
  rect: { left: 0, top: 75, width: 800, height: 450 },
  frameWidth: 1280,
  frameHeight: 720,
};

describe("mark coordinate mapping", () => {
  it("maps frame-space points onto the rendered video rect", () => {
    // Frame center (640, 360) -> rect center (400, 75 + 225 = 300).
    expect(mapPoint(640, 360, "frame", 800, 600, FRAME)).toEqual({
      x: 400,
      y: 300,
    });
    // Frame origin -> rect top-left.
    expect(mapPoint(0, 0, "frame", 800, 600, FRAME)).toEqual({ x: 0, y: 75 });
  });

  it("maps normalized points directly onto the container", () => {
    expect(mapPoint(0.5, 0.5, "normalized", 800, 600, null)).toEqual({
      x: 400,
      y: 300,
    });
  });

  it("returns null for a frame-space mark with no frame", () => {
    expect(mapPoint(10, 10, "frame", 800, 600, null)).toBeNull();
  });

  it("scales frame-space lengths onto the rect", () => {
    // 1280 frame px across -> 800 rect px; 128 -> 80.
    expect(mapScale(128, "x", "frame", 800, 600, FRAME)).toBe(80);
    // 720 frame px -> 450 rect px; 72 -> 45.
    expect(mapScale(72, "y", "frame", 800, 600, FRAME)).toBe(45);
  });
});

describe("cockpit marks store", () => {
  beforeEach(() => {
    const { bySource, clearSource } = useCockpitMarksStore.getState();
    for (const id of [...bySource.keys()]) clearSource(id);
  });

  it("composites marks from multiple sources", () => {
    const { setMarks, all } = useCockpitMarksStore.getState();
    setMarks("plugin:gimbal", [
      { kind: "point", id: "reticle", x: 1, y: 2 },
    ]);
    setMarks("plugin:thermal", [
      { kind: "box", id: "blob", x: 0, y: 0, width: 5, height: 5 },
    ]);
    expect(all()).toHaveLength(2);
  });

  it("setMarks replaces a source; clearSource drops it", () => {
    const { setMarks, clearSource, all } = useCockpitMarksStore.getState();
    setMarks("s", [{ kind: "point", id: "a", x: 0, y: 0 }]);
    setMarks("s", []); // replace with none (key retained)
    expect(all()).toHaveLength(0);
    setMarks("s", [{ kind: "point", id: "b", x: 1, y: 1 }]);
    expect(all()).toHaveLength(1);
    clearSource("s");
    expect(all()).toHaveLength(0);
  });
});

describe("parseCockpitMarks (untrusted plugin input)", () => {
  it("returns [] for non-array input", () => {
    expect(parseCockpitMarks(null)).toEqual([]);
    expect(parseCockpitMarks({ marks: [] })).toEqual([]);
    expect(parseCockpitMarks("nope")).toEqual([]);
  });

  it("accepts each valid mark kind and carries optional fields", () => {
    const marks = parseCockpitMarks([
      { kind: "box", id: "b", x: 1, y: 2, width: 3, height: 4, dashed: true },
      { kind: "reticle", id: "r", x: 0, y: 0, width: 10, height: 10, space: "normalized" },
      { kind: "point", id: "p", x: 5, y: 6, radius: 3, color: "#f00" },
      { kind: "polyline", id: "l", points: [[0, 0], [1, 1]], width: 2 },
      { kind: "label", id: "t", x: 1, y: 2, text: "hi" },
    ]);
    expect(marks).toHaveLength(5);
    expect(marks[0]).toMatchObject({ kind: "box", dashed: true });
    expect(marks[1]).toMatchObject({ kind: "reticle", space: "normalized" });
    expect(marks[2]).toMatchObject({ kind: "point", radius: 3, color: "#f00" });
    expect(marks[3]).toMatchObject({ kind: "polyline" });
    expect(marks[4]).toMatchObject({ kind: "label", text: "hi" });
  });

  it("drops malformed entries but keeps the valid ones", () => {
    const marks = parseCockpitMarks([
      { kind: "box", id: "ok", x: 1, y: 2, width: 3, height: 4 },
      { kind: "box", id: "no-dims", x: 1, y: 2 }, // missing width/height
      { kind: "point", x: 1, y: 2 }, // missing id
      { kind: "unknown", id: "x", x: 1, y: 2 }, // unknown kind
      { kind: "polyline", id: "bad", points: [[0]] }, // malformed point
      { kind: "point", id: "nan", x: Number.NaN, y: 2 }, // non-finite
      "garbage",
    ]);
    expect(marks.map((m) => m.id)).toEqual(["ok"]);
  });

  it("rejects an invalid space and drops an unknown-typed color", () => {
    const [mark] = parseCockpitMarks([
      { kind: "point", id: "p", x: 1, y: 2, space: "world", color: 42 },
    ]);
    expect(mark).toMatchObject({ kind: "point", id: "p" });
    expect("space" in mark).toBe(false);
    expect("color" in mark).toBe(false);
  });

  it("caps the number of marks per post", () => {
    const many = Array.from({ length: MAX_MARKS_PER_SOURCE + 50 }, (_, i) => ({
      kind: "point",
      id: `p${i}`,
      x: i,
      y: i,
    }));
    expect(parseCockpitMarks(many)).toHaveLength(MAX_MARKS_PER_SOURCE);
  });

  it("bounds polyline points per mark and per source, and label text", () => {
    const pts = (n: number) => Array.from({ length: n }, (_, i) => [i, i]);
    const parsed = parseCockpitMarks([
      { kind: "polyline", id: "huge", points: pts(MAX_POINTS_PER_POLYLINE * 10) },
      ...Array.from({ length: 8 }, (_, i) => ({
        kind: "polyline",
        id: `l${i}`,
        points: pts(MAX_POINTS_PER_POLYLINE),
      })),
      { kind: "label", id: "t", x: 0, y: 0, text: "x".repeat(10_000) },
    ]);
    let total = 0;
    for (const m of parsed) {
      if (m.kind === "polyline") {
        expect(m.points.length).toBeLessThanOrEqual(MAX_POINTS_PER_POLYLINE);
        total += m.points.length;
      }
    }
    expect(total).toBe(MAX_POINTS_PER_SOURCE);
    const label = parsed.find((m) => m.kind === "label");
    expect(label?.kind === "label" && label.text.length).toBe(MAX_LABEL_CHARS);
  });
});
