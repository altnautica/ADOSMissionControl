import { describe, expect, it } from "vitest";

import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { airframeResettable, launchLiftoffLine, liftoffLineText } from "@/lib/hud/liftoff";

const seq = (over: Record<string, unknown>) =>
  parsePilotState({ owner: "pilot", sequence: { step: "takeoff", after: "hold", error: null, ...over } })!.sequence;

describe("the launch's steady take-off line", () => {
  it("reads the status line and its detail while it runs", () => {
    const s = seq({ liftoff: { phase: "climb", text: "Airborne", detail: "Climbing to 3 m", trim: "learned", tilt_deg: 0.4 } });
    expect(s!.liftoff).toEqual({ phase: "climb", text: "Airborne", detail: "Climbing to 3 m", trim: "learned", tiltDeg: 0.4 });
    const line = launchLiftoffLine(s)!;
    expect(line).toEqual({ status: "Airborne", detail: "Climbing to 3 m" });
    expect(liftoffLineText(line)).toBe("Airborne. Climbing to 3 m");
  });

  it("reads the status alone from an agent that sends no detail", () => {
    const s = seq({ liftoff: { phase: "spool", text: "Spinning up", trim: "probe", tilt_deg: 0 } });
    expect(launchLiftoffLine(s)).toEqual({ status: "Spinning up", detail: null });
    expect(liftoffLineText(launchLiftoffLine(s)!)).toBe("Spinning up");
  });

  it("reads the stop once it stopped on the ground", () => {
    const s = seq({
      error: "liftoff_tipping",
      liftoff: { phase: "stopped", text: "Take-off stopped", detail: "The drone started to tip. Motors off.", trim: "probe", tilt_deg: 2 },
    });
    expect(liftoffLineText(launchLiftoffLine(s)!)).toBe("Take-off stopped. The drone started to tip. Motors off.");
  });

  it("says nothing without a steady take-off or for another error", () => {
    expect(launchLiftoffLine(seq({}))).toBeNull();
    expect(launchLiftoffLine(seq({ error: "disarmed", liftoff: { phase: "climb", text: "Airborne", trim: "learned", tilt_deg: 0 } }))).toBeNull();
    expect(launchLiftoffLine(seq({ liftoff: { phase: "warp", text: "?" } }))).toBeNull();
    expect(launchLiftoffLine(null)).toBeNull();
  });
});

describe("I rebalanced it", () => {
  it("is offered on a failing Balance check of a disarmed vehicle", () => {
    expect(airframeResettable({ id: "airframe_balance", ok: false }, false)).toBe(true);
    expect(airframeResettable({ id: "airframe_balance", ok: false }, true)).toBe(false);
    expect(airframeResettable({ id: "airframe_balance", ok: false }, null)).toBe(false);
    expect(airframeResettable({ id: "airframe_balance", ok: true }, false)).toBe(false);
    expect(airframeResettable({ id: "supervised_liftoff", ok: false }, false)).toBe(false);
  });
});
