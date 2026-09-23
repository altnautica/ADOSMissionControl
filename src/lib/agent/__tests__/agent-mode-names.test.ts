/**
 * The name an agent-routed mode change sends: the agent's own name for the
 * GCS mode in the table of the vehicle's firmware, or none when that table
 * has no equivalent.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { agentModeName } from "../agent-mode-names";

describe("agentModeName", () => {
  it("refuses a copter-only name on a plane or rover", () => {
    expect(agentModeName("ardupilot-copter", "ALT_HOLD")).toBe("ALT_HOLD");
    expect(agentModeName("ardupilot-plane", "ALT_HOLD")).toBeNull();
    expect(agentModeName("ardupilot-rover", "ALT_HOLD")).toBeNull();
    expect(agentModeName("ardupilot-plane", "FBWA")).toBe("FBWA");
    expect(agentModeName("ardupilot-rover", "HOLD")).toBe("HOLD");
  });

  it("takes only names on every ArduPilot table when the airframe is unknown", () => {
    expect(agentModeName("ardupilot", "GUIDED")).toBe("GUIDED");
    expect(agentModeName("ardupilot", "LOITER")).toBe("LOITER");
    expect(agentModeName("ardupilot", "STABILIZE")).toBeNull();
  });

  it("translates GCS presets to the agent's PX4 names", () => {
    expect(agentModeName("px4", "ALT_HOLD")).toBe("ALTCTL");
    expect(agentModeName("px4", "POSHOLD")).toBe("POSCTL");
    expect(agentModeName("px4", "STABILIZE")).toBe("STABILIZED");
    expect(agentModeName("px4", "FOLLOW_ME")).toBe("FOLLOW_TARGET");
    expect(agentModeName("px4", "LOITER")).toBe("LOITER");
    expect(agentModeName("px4", "RTL")).toBe("RTL");
  });

  it("offers nothing without an equivalent in the agent's table", () => {
    expect(agentModeName("px4", "ORBIT")).toBeNull();
    expect(agentModeName("px4", "VTOL_TAKEOFF")).toBeNull();
    expect(agentModeName("ardupilot-sub", "STABILIZE")).toBeNull();
    expect(agentModeName("inav", "LOITER")).toBeNull();
  });
});
