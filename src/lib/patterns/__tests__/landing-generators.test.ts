/**
 * @module patterns/__tests__/landing-generators
 * @description Unit tests for the fixed-wing and VTOL landing pattern generators.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { generateFixedWingLanding } from "../landing-generator";
import { generateVtolLanding } from "../vtol-landing-generator";
import { patternToMission } from "../pattern-to-mission";
import { expandToItems } from "@/lib/mission/mission-expand";
import { cmdMap } from "@/lib/mission-io-formats";
import { haversineDistance } from "@/lib/drawing/geo-utils";
import { bearing } from "@/lib/telemetry-utils";
import type { FixedWingLandingConfig, VtolLandingConfig } from "../types";

const LANDING: [number, number] = [12.95, 77.668];

/** The pattern store holds no heading until the operator enters one. */
const UNSET_HEADING = undefined as unknown as number;

describe("generateFixedWingLanding", () => {
  const config: FixedWingLandingConfig = {
    landingPoint: LANDING,
    approachHeading: 90,
    glideSlopeAngle: 5,
    loiterAltitude: 60,
    speed: 15,
  };

  it("leads with DO_LAND_START so an RTL autoland jump still flies the approach waypoint", () => {
    const waypoints = patternToMission(generateFixedWingLanding(config).waypoints, "relative");
    const commands = expandToItems(waypoints, { defaultFrame: "relative", defaultSpeed: 15 })
      .map((it) => it.command)
      .filter((c) => c !== cmdMap.DO_SET_SPEED);
    const landStart = commands.indexOf(cmdMap.DO_LAND_START);
    expect(landStart).toBeGreaterThanOrEqual(0);
    // The FC resumes at the item after the marker: the approach, then the landing.
    expect(commands.slice(landStart)).toEqual([cmdMap.DO_LAND_START, cmdMap.WAYPOINT, cmdMap.LAND]);
  });

  it("ends at the configured landing point on the ground", () => {
    const result = generateFixedWingLanding(config);
    const last = result.waypoints[result.waypoints.length - 1];
    expect(last.lat).toBeCloseTo(LANDING[0], 6);
    expect(last.lon).toBeCloseTo(LANDING[1], 6);
    expect(last.alt).toBe(0);
  });

  it("places the approach waypoint so the descent follows the configured glide slope", () => {
    for (const glideSlopeAngle of [3, 5, 8]) {
      for (const loiterAltitude of [60, 150]) {
        const result = generateFixedWingLanding({ ...config, glideSlopeAngle, loiterAltitude });
        const start = result.waypoints[0];
        const run = haversineDistance(start.lat, start.lon, LANDING[0], LANDING[1]);
        const flownSlope = (Math.atan(start.alt / run) * 180) / Math.PI;
        expect(start.alt).toBe(loiterAltitude);
        expect(flownSlope).toBeCloseTo(glideSlopeAngle, 1);
        expect(result.stats.totalDistance).toBeCloseTo(run, 0);
      }
    }
  });

  it("flies the final along the configured approach heading", () => {
    for (const approachHeading of [0, 90, 225, 315]) {
      const result = generateFixedWingLanding({ ...config, approachHeading });
      const start = result.waypoints[0];
      const course = bearing(start.lat, start.lon, LANDING[0], LANDING[1]);
      const error = Math.abs(((course - approachHeading + 540) % 360) - 180);
      expect(error).toBeLessThan(0.5);
    }
  });

  it("generates no landing until a final-approach heading is chosen", () => {
    expect(generateFixedWingLanding({ ...config, approachHeading: UNSET_HEADING }).waypoints).toHaveLength(0);
    expect(generateFixedWingLanding({ ...config, approachHeading: -1 }).waypoints).toHaveLength(0);
  });

  it("returns no waypoints when the glide slope cannot describe a descent", () => {
    expect(generateFixedWingLanding({ ...config, glideSlopeAngle: 0 }).waypoints).toHaveLength(0);
    expect(generateFixedWingLanding({ ...config, loiterAltitude: 0 }).waypoints).toHaveLength(0);
  });
});

describe("generateVtolLanding", () => {
  const config: VtolLandingConfig = {
    landingPoint: LANDING,
    approachHeading: 180,
    transitionDistance: 150,
    approachAltitude: 50,
    descentSpeed: 2,
    speed: 8,
  };

  /** The uploaded wire items of an applied VTOL landing. */
  function uploadedItems(cfg: VtolLandingConfig) {
    const waypoints = patternToMission(generateVtolLanding(cfg).waypoints, "relative");
    return expandToItems(waypoints, { defaultFrame: "relative", defaultSpeed: 5 });
  }

  it("lands vertically straight from the approach waypoint, never flying a low waypoint first", () => {
    const items = uploadedItems(config);
    const nav = items.filter((it) => it.command !== cmdMap.DO_SET_SPEED);
    expect(nav.map((it) => it.command)).toEqual([cmdMap.TAKEOFF, cmdMap.WAYPOINT, cmdMap.VTOL_LAND]);
    // Everything flown before the vertical landing is at the approach altitude.
    for (const it of nav.slice(0, -1)) expect(it.z).toBe(config.approachAltitude);
    const land = nav[nav.length - 1];
    expect(land.x).toBe(Math.round(LANDING[0] * 1e7));
    expect(land.y).toBe(Math.round(LANDING[1] * 1e7));
  });

  it("does not send the vertical descent speed as a ground speed for the approach leg", () => {
    const speeds = uploadedItems(config)
      .filter((it) => it.command === cmdMap.DO_SET_SPEED)
      .map((it) => it.param2);
    expect(speeds).not.toContain(config.descentSpeed);
  });

  it("approaches along the configured heading", () => {
    const [approach] = generateVtolLanding(config).waypoints;
    const course = bearing(approach.lat, approach.lon, LANDING[0], LANDING[1]);
    expect(Math.abs(((course - config.approachHeading + 540) % 360) - 180)).toBeLessThan(0.5);
    expect(haversineDistance(approach.lat, approach.lon, LANDING[0], LANDING[1])).toBeCloseTo(config.transitionDistance, 0);
  });

  it("generates no landing until a final-approach heading is chosen", () => {
    expect(generateVtolLanding({ ...config, approachHeading: UNSET_HEADING }).waypoints).toHaveLength(0);
    expect(generateVtolLanding({ ...config, approachHeading: -1 }).waypoints).toHaveLength(0);
  });

  it("returns no waypoints when the geometry is invalid", () => {
    const result = generateVtolLanding({ ...config, approachAltitude: 0 });
    expect(result.waypoints).toHaveLength(0);
  });
});
