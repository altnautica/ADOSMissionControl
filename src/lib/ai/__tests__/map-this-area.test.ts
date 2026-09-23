/**
 * @module ai/__tests__/map-this-area
 * @description Unit tests for the quick "map this area" survey builder.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { quickSurveyFromBounds, QUICK_SURVEY_MAX_PATH_M, type MapBounds } from "../map-this-area";
import { CAMERA_PROFILES, computeGSD } from "../../patterns/gsd-calculator";

// A small box near Bangalore (~ a few hundred meters on a side).
const BOX: MapBounds = { north: 12.972, south: 12.968, east: 77.596, west: 77.59 };

describe("quickSurveyFromBounds", () => {
  it("yields a 4-corner polygon matching the bounds", () => {
    const { polygon, config } = quickSurveyFromBounds(BOX, {
      altitudeM: 50,
      overlapPct: 70,
    });
    expect(polygon).toHaveLength(4);
    expect(config.polygon).toHaveLength(4);
    // Corners cover the bbox extremes.
    const lats = polygon.map((p) => p[0]);
    const lons = polygon.map((p) => p[1]);
    expect(Math.max(...lats)).toBeCloseTo(BOX.north, 6);
    expect(Math.min(...lats)).toBeCloseTo(BOX.south, 6);
    expect(Math.max(...lons)).toBeCloseTo(BOX.east, 6);
    expect(Math.min(...lons)).toBeCloseTo(BOX.west, 6);
  });

  it("produces a sane, positive line spacing and passes altitude through", () => {
    const { config } = quickSurveyFromBounds(BOX, { altitudeM: 50, overlapPct: 70 });
    expect(config.altitude).toBe(50);
    expect(config.speed).toBeGreaterThan(0);
    // No camera: footprint ~= altitude, 70% overlap => ~15 m spacing.
    expect(config.lineSpacing).toBeGreaterThan(0);
    expect(config.lineSpacing).toBeLessThan(50);
    expect(config.lineSpacing).toBeCloseTo(15, 5);
  });

  it("runs lines along the longer axis (wide box => east-west lines)", () => {
    // Wider east-west than north-south. Lines should run east-west (gridAngle 0)
    // so the transects step across the shorter north-south extent (fewest turns).
    const wide: MapBounds = { north: 12.97, south: 12.969, east: 77.61, west: 77.59 };
    const { config } = quickSurveyFromBounds(wide, { altitudeM: 40, overlapPct: 60 });
    expect(config.gridAngle).toBe(0);
  });

  it("runs lines along the longer axis (tall box => north-south lines)", () => {
    // Taller north-south than east-west. Lines should run north-south (gridAngle 90).
    const tall: MapBounds = { north: 12.99, south: 12.96, east: 77.5905, west: 77.59 };
    const { config } = quickSurveyFromBounds(tall, { altitudeM: 40, overlapPct: 60 });
    expect(config.gridAngle).toBe(90);
  });

  it("derives tighter footprint-based spacing from a camera profile", () => {
    const camera = CAMERA_PROFILES.find((c) => c.name === "DJI Mavic 3")!;
    const { config } = quickSurveyFromBounds(BOX, {
      altitudeM: 50,
      overlapPct: 70,
      camera,
    });
    const gsd = computeGSD(50, camera.focalLength, camera.sensorWidth, camera.imageWidth);
    const expectedSpacing = gsd * camera.imageWidth * (1 - 0.7);
    expect(config.lineSpacing).toBeCloseTo(expectedSpacing, 4);
    // A camera enables a non-zero trigger distance for photogrammetry.
    expect(config.cameraTriggerDistance).toBeGreaterThan(0);
  });

  it("leaves camera triggers disabled when no camera is supplied", () => {
    const { config } = quickSurveyFromBounds(BOX, { altitudeM: 50, overlapPct: 70 });
    expect(config.cameraTriggerDistance).toBe(0);
  });

  it("normalizes flipped bounds so corners still cover the box", () => {
    const flipped: MapBounds = { north: 12.968, south: 12.972, east: 77.59, west: 77.596 };
    const { config } = quickSurveyFromBounds(flipped, { altitudeM: 50, overlapPct: 70 });
    const lats = config.polygon.map((p) => p[0]);
    const lons = config.polygon.map((p) => p[1]);
    expect(Math.max(...lats)).toBeCloseTo(12.972, 6);
    expect(Math.min(...lats)).toBeCloseTo(12.968, 6);
    expect(Math.max(...lons)).toBeCloseTo(77.596, 6);
    expect(Math.min(...lons)).toBeCloseTo(77.59, 6);
  });

  it("clamps extreme overlap so spacing never collapses to zero", () => {
    const { config } = quickSurveyFromBounds(BOX, { altitudeM: 50, overlapPct: 200 });
    expect(config.lineSpacing).toBeGreaterThan(0);
  });

  it("floors spacing at the minimum for tiny altitudes", () => {
    const { config } = quickSurveyFromBounds(BOX, { altitudeM: 0.5, overlapPct: 90 });
    expect(config.lineSpacing).toBeGreaterThanOrEqual(1);
  });

  it("estimates a small box as a small survey", () => {
    const { estimate } = quickSurveyFromBounds(BOX, { altitudeM: 50, overlapPct: 70 });
    // ~430 m tall box at 15 m spacing.
    expect(estimate.transects).toBeGreaterThan(20);
    expect(estimate.transects).toBeLessThan(40);
    expect(estimate.items).toBe(estimate.transects * 2);
    expect(estimate.pathLengthM).toBeLessThan(QUICK_SURVEY_MAX_PATH_M);
  });

  it("estimates a zoomed-out viewport far beyond a flyable mission", () => {
    // Roughly the planner's opening view: ~20 x 15 km.
    const wide: MapBounds = { north: 13.04, south: 12.9, east: 77.69, west: 77.5 };
    const { estimate } = quickSurveyFromBounds(wide, { altitudeM: 50, overlapPct: 70 });
    expect(estimate.items).toBeGreaterThan(1000);
    expect(estimate.pathLengthM).toBeGreaterThan(QUICK_SURVEY_MAX_PATH_M);
  });
});
