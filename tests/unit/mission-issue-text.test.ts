/**
 * Every mission issue carries a translation key under `planner.issue` whose
 * English rendering, with the issue's params, is exactly its `message`.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import messages from "../../locales/en.json";
import { validateMission } from "@/lib/validation/mission-validator";
import type { ValidationIssue } from "@/lib/validation/issue-types";
import { checkSoftBuffer } from "@/lib/validation/soft-geofence";
import type { PlanVehicleProfile, Waypoint } from "@/lib/types/mission";

// Issue keys are data, so the catalogue is read as plain strings, the way the
// planner's `useTranslations("planner.issue")` reads it.
const issueMessages: Record<string, string> = messages.planner.issue;
const t = createTranslator({ locale: "en", messages: issueMessages });

let seq = 0;
function wp(o: Partial<Waypoint> & { lat: number; lon: number }): Waypoint {
  return { id: `w${++seq}`, alt: 50, command: "WAYPOINT", ...o };
}

const PROFILES: (PlanVehicleProfile | undefined)[] = [
  undefined,
  { autopilot: "ardupilot", vehicleClass: "copter" },
  { autopilot: "ardupilot", vehicleClass: "plane" },
  { autopilot: "ardupilot", vehicleClass: "rover" },
  { autopilot: "px4", vehicleClass: "copter" },
];

function missions(): Waypoint[][] {
  const dup = wp({ lat: 12.971, lon: 77.59 });
  return [
    [],
    [wp({ lat: 12.97, lon: 77.59, alt: 40 })],
    [wp({ lat: 12.97, lon: 77.59, alt: 0 }), wp({ lat: 12.971, lon: 77.59 })],
    [
      wp({ lat: 12.97, lon: 77.59, alt: 30, command: "TAKEOFF" }),
      dup,
      { ...dup },
      wp({ lat: 0, lon: 0, alt: 50 }),
      wp({ lat: 91, lon: 200, alt: 50 }),
      wp({ lat: 12.99, lon: 77.59, alt: 900 }),
      wp({ lat: 12.98, lon: 77.59, alt: 50, command: "DO_LAND_START" }),
    ],
  ];
}

function expectParity(issue: Pick<ValidationIssue, "message" | "text">) {
  expect(t.has(issue.text.key)).toBe(true);
  expect(t(issue.text.key, issue.text.params)).toBe(issue.message);
}

describe("mission issue text", () => {
  it("renders every issue from its key exactly as its English message", () => {
    let seen = 0;
    for (const profile of PROFILES) {
      for (const mission of missions()) {
        const result = validateMission(mission, {
          profile,
          rtlAutoland: 0,
          linkRangeM: 500,
          geofence: { maxAltitude: 120, minAltitude: 10, polygonPoints: [
            [12.96, 77.58], [12.96, 77.6], [12.975, 77.6], [12.975, 77.58],
          ] },
          rally: [{ id: "r1", lat: 0, lon: 0, alt: 500 }],
        } as Parameters<typeof validateMission>[1]);
        for (const issue of [...result.errors, ...result.warnings]) {
          expectParity(issue);
          seen++;
        }
      }
    }
    expect(seen).toBeGreaterThan(10);
  });

  it("renders the soft-buffer warning from its key", () => {
    const [w] = checkSoftBuffer([wp({ lat: 0.0009, lon: 0 })], { circleCenter: [0, 0], circleRadius: 110 }, 30);
    expectParity(w);
  });
});
