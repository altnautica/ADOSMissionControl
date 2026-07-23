/**
 * @module skills/autonomous-nav-capability.test
 * @description The autonomous-nav gate is driven off a node's real firmware
 * capability, not a blanket-false `supports`. A firmware known to have
 * autonomous nav (ArduPilot / PX4 / iNav) reports "supported", one known to
 * lack it (Betaflight) reports "unsupported", and an unidentified firmware
 * reports "unknown" — never "unsupported" — so RTL / Land / Takeoff are hidden
 * only when the vehicle genuinely cannot do them, and kept (not hidden on a
 * guess) when the firmware simply has not been identified.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import { autonomousNavForNode } from "../node-context";

describe("autonomousNavForNode", () => {
  it("reports ArduPilot with an airframe as supported", () => {
    expect(autonomousNavForNode("ardupilot", "copter")).toBe("supported");
    expect(autonomousNavForNode("ardupilot", "plane")).toBe("supported");
    expect(autonomousNavForNode("ardupilot", "rover")).toBe("supported");
  });

  it("reports the ArduPilot family as supported even without an airframe", () => {
    expect(autonomousNavForNode("ardupilot")).toBe("supported");
    expect(autonomousNavForNode("ArduPilot", undefined)).toBe("supported");
  });

  it("reports PX4 and iNav as supported", () => {
    expect(autonomousNavForNode("px4")).toBe("supported");
    expect(autonomousNavForNode("inav")).toBe("supported");
  });

  it("reports Betaflight as unsupported", () => {
    expect(autonomousNavForNode("betaflight")).toBe("unsupported");
  });

  it("reports an unidentified firmware as unknown, never unsupported", () => {
    expect(autonomousNavForNode(undefined, undefined)).toBe("unknown");
    expect(autonomousNavForNode("", "")).toBe("unknown");
    expect(autonomousNavForNode("some-unrecognised-fw")).toBe("unknown");
  });
});
