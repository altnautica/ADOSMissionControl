/**
 * A new Set Speed action changes the speed the vehicle actually flies to: the
 * airspeed target on a fixed-wing vehicle (MAV_CMD_DO_CHANGE_SPEED type 0) and
 * ground speed otherwise (type 1).
 * @license GPL-3.0-only
 */
import { describe, it, expect } from "vitest";
import { defaultActionParams } from "@/components/planner/waypoint-constants";

const AT = { lat: 1, lon: 1 };

describe("Set Speed action default", () => {
  it("targets airspeed on a plane and a VTOL", () => {
    expect(defaultActionParams("DO_SET_SPEED", AT, "plane")).toMatchObject({ param1: 0, param2: 5 });
    expect(defaultActionParams("DO_SET_SPEED", AT, "vtol")).toMatchObject({ param1: 0 });
  });

  it("targets ground speed on a copter or an unknown vehicle", () => {
    expect(defaultActionParams("DO_SET_SPEED", AT, "copter")).toMatchObject({ param1: 1, param2: 5 });
    expect(defaultActionParams("DO_SET_SPEED", AT, null)).toMatchObject({ param1: 1 });
  });
});
