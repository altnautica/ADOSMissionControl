import { describe, it, expect } from "vitest";
import { generateSplinePath } from "@/lib/spline-interpolation";

const A = { lat: 0, lon: 0, command: "WAYPOINT" };
const B = { lat: 0.001, lon: 0.001, command: "SPLINE_WAYPOINT" };
const C = { lat: 0, lon: 0.002, command: "WAYPOINT" };

describe("generateSplinePath", () => {
  it("curves the leg into a spline waypoint", () => {
    const path = generateSplinePath([A, B]);
    expect(path.length).toBeGreaterThan(2);
    expect(path[0]).toEqual([A.lat, A.lon]);
    expect(path[path.length - 1]).toEqual([B.lat, B.lon]);
  });

  it("draws the leg leaving a spline waypoint toward a normal waypoint straight", () => {
    const path = generateSplinePath([A, B, C]);
    // After reaching B the only remaining vertex is C: a straight chord.
    const atB = path.findIndex(([lat, lon]) => lat === B.lat && lon === B.lon);
    expect(atB).toBeGreaterThan(0);
    expect(path.slice(atB)).toEqual([
      [B.lat, B.lon],
      [C.lat, C.lon],
    ]);
  });

  it("keeps a path of normal waypoints straight", () => {
    expect(generateSplinePath([A, C])).toEqual([
      [A.lat, A.lon],
      [C.lat, C.lon],
    ]);
  });
});
