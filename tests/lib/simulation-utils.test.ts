import { describe, expect, it } from "vitest";
import type { Waypoint } from "@/lib/types";
import {
  computeFlightPlan,
  createSimulationMissionSignature,
  interpolatePosition,
} from "@/lib/simulation-utils";
import { haversineDistance } from "@/lib/geo/distance";

const baseWaypoints: Waypoint[] = [
  { id: "wp-1", lat: 12.9716, lon: 77.5946, alt: 30, command: "TAKEOFF" },
  { id: "wp-2", lat: 12.972, lon: 77.595, alt: 45, speed: 8 },
];

describe("createSimulationMissionSignature", () => {
  it("stays stable for equivalent simulation inputs", () => {
    expect(createSimulationMissionSignature(baseWaypoints, 6, "relative")).toBe(
      createSimulationMissionSignature([...baseWaypoints], 6, "relative")
    );
  });

  it("changes when same-count waypoint content changes", () => {
    const changed = [
      baseWaypoints[0],
      { ...baseWaypoints[1], lat: baseWaypoints[1].lat + 0.001 },
    ];

    expect(createSimulationMissionSignature(changed, 6, "relative")).not.toBe(
      createSimulationMissionSignature(baseWaypoints, 6, "relative")
    );
  });

  it("changes when default speed changes", () => {
    expect(createSimulationMissionSignature(baseWaypoints, 7, "relative")).not.toBe(
      createSimulationMissionSignature(baseWaypoints, 6, "relative")
    );
  });

  it("changes when the planner default frame or a waypoint's own frame changes", () => {
    const base = createSimulationMissionSignature(baseWaypoints, 6, "relative");
    expect(createSimulationMissionSignature(baseWaypoints, 6, "terrain")).not.toBe(base);
    const framed = [baseWaypoints[0], { ...baseWaypoints[1], frame: "absolute" as const }];
    expect(createSimulationMissionSignature(framed, 6, "relative")).not.toBe(base);
  });
});

describe("computeFlightPlan hold time", () => {
  // Two points ~111 m apart flown at 10 m/s: about 11 s of flying.
  const leg = (command: Waypoint["command"]): Waypoint[] => [
    { id: "a", lat: 0, lon: 0, alt: 20, command, holdTime: 30 },
    { id: "b", lat: 0.001, lon: 0, alt: 20, command: "WAYPOINT" },
  ];
  const flying = computeFlightPlan(leg("LOITER_TURNS"), 10).totalDuration;

  it("counts the hold of a waypoint and a timed loiter", () => {
    expect(computeFlightPlan(leg("WAYPOINT"), 10).totalDuration).toBeCloseTo(flying + 30, 6);
    expect(computeFlightPlan(leg("LOITER_TIME"), 10).totalDuration).toBeCloseTo(flying + 30, 6);
  });

  it("never counts a hold for an unlimited loiter, which does not advance on its own", () => {
    expect(computeFlightPlan(leg("LOITER"), 10).totalDuration).toBeCloseTo(flying, 6);
    const endsInLoiter: Waypoint[] = [
      { id: "a", lat: 0, lon: 0, alt: 20, command: "WAYPOINT" },
      { id: "b", lat: 0.001, lon: 0, alt: 20, command: "LOITER", holdTime: 30 },
    ];
    expect(computeFlightPlan(endsInLoiter, 10).totalDuration).toBeCloseTo(flying, 6);
  });
});

describe("computeFlightPlan RTL and action items", () => {
  // Launch, then a waypoint about 2 km north, then RTL placed (as the planner
  // does) at the last waypoint's position at 0 m.
  const launch = { lat: 12.9716, lon: 77.5946 };
  const far = { lat: 12.9896, lon: 77.5946 };
  const mission: Waypoint[] = [
    { id: "t", ...launch, alt: 30, command: "TAKEOFF" },
    { id: "w", ...far, alt: 30 },
    { id: "r", ...far, alt: 0, command: "RTL" },
  ];

  it("flies RTL back to home instead of descending in place", () => {
    const plan = computeFlightPlan(mission, 10);
    const leg = haversineDistance(launch.lat, launch.lon, far.lat, far.lon);
    // Out and back, plus the descent at home: never just the outbound leg.
    expect(plan.totalDistance).toBeGreaterThan(2 * leg);
    const end = interpolatePosition(plan.segments, mission, plan.totalDuration);
    expect(end.lat).toBeCloseTo(launch.lat, 6);
    expect(end.lon).toBeCloseTo(launch.lon, 6);
    expect(end.alt).toBe(0);
  });

  it("never flies to a positionless action item", () => {
    const withAction: Waypoint[] = [
      mission[0],
      { id: "a", lat: 0, lon: 0, alt: 0, command: "DO_SET_SPEED", param1: 5 },
      mission[1],
    ];
    const plan = computeFlightPlan(withAction, 10);
    const leg = haversineDistance(launch.lat, launch.lon, far.lat, far.lon);
    expect(plan.totalDistance).toBeCloseTo(leg, 0);
  });
});
