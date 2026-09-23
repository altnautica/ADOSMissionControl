import { describe, expect, it } from "vitest";
import type { Waypoint } from "@/lib/types";
import { computeFlightPlan, createSimulationMissionSignature } from "@/lib/simulation-utils";

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
