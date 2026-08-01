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
import { autonomousNavFromCapabilities } from "../autonomous-nav";
import type { ProtocolCapabilities } from "@/lib/protocol/types";

/** A capability set with everything off except the flags a test sets. */
function caps(over: Partial<ProtocolCapabilities>): ProtocolCapabilities {
  return { supportsGeoFence: false, supportsAutonomousNav: false, ...over } as ProtocolCapabilities;
}

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

describe("autonomousNavFromCapabilities", () => {
  // The gate used to read the geofence flag as a stand-in, which ties whether
  // the skill bar offers a return-to-home to an unrelated feature. It reads the
  // navigation flag itself now, so the two can differ without the skills going
  // wrong in either direction.
  it("reads the navigation flag, not the geofence one", () => {
    expect(
      autonomousNavFromCapabilities(caps({ supportsAutonomousNav: true, supportsGeoFence: false })),
    ).toBe("supported");
    expect(
      autonomousNavFromCapabilities(caps({ supportsAutonomousNav: false, supportsGeoFence: true })),
    ).toBe("unsupported");
  });

  it("reports unknown when there are no capabilities to read", () => {
    expect(autonomousNavFromCapabilities(undefined)).toBe("unknown");
    expect(autonomousNavFromCapabilities(null)).toBe("unknown");
  });
});
