/**
 * Take-off goes to the drone's pilot as `launch {after: "hold", alt_m}`
 * whenever a live pilot is on the stream, in every control mode, so the
 * pilot's supervised lift-off flies it. Arm and NAV_TAKEOFF reach the flight
 * controller only without a pilot.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { takeoffSkill } from "../builtins/takeoff";
import { handlePilotServerFrame, setPilotSender, usePilotLinkStore } from "@/lib/input/pilot-stream";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import type { SkillContext } from "../types";

const OK = { success: true, resultCode: 0, message: "" };

function ctx() {
  const arm = vi.fn(async () => OK);
  const takeoff = vi.fn(async () => OK);
  const c = {
    droneId: "d1",
    protocol: { arm, takeoff } as never,
    armState: "disarmed",
    flightMode: "LOITER",
    availableModes: [],
    missionState: "none",
    supports: () => true,
    autonomousNav: "yes",
    checklistReady: true,
    confirm: async () => ({ approved: true }) as never,
    notify: () => undefined,
  } as unknown as SkillContext;
  return { c, arm, takeoff };
}

let sent: Array<{ name: string; id: string; args?: Record<string, unknown> }> = [];

function pilotOn(controlMode: "ados" | "fc_manual" | "elrs") {
  setPilotSender(((f: { op: string; name: string; id: string; args?: Record<string, unknown> }) => {
    if (f.op !== "action") return true;
    sent.push({ name: f.name, id: f.id, args: f.args });
    queueMicrotask(() => handlePilotServerFrame("d1", { kind: "action_result", name: f.name, id: f.id, ok: true }));
    return true;
  }) as never, "d1");
  usePilotLinkStore.getState().set({ controlMode });
  useNavStreamStore.setState({ byDrone: { d1: { pilot: { data: null, receivedAt: Date.now() } } } as never });
}

describe("take-off route", () => {
  beforeEach(() => {
    sent = [];
  });
  afterEach(() => {
    setPilotSender(null);
    useNavStreamStore.setState({ byDrone: {} });
  });

  it.each(["ados", "fc_manual", "elrs"] as const)("sends the pilot's launch in %s mode", async (mode) => {
    pilotOn(mode);
    const { c, arm, takeoff } = ctx();
    const r = await takeoffSkill.activate(c, { altitudeM: 7 });
    expect(sent).toEqual([{ name: "launch", id: expect.any(String), args: { after: "hold", alt_m: 7 } }]);
    expect(r).toMatchObject({ success: true });
    expect(arm).not.toHaveBeenCalled();
    expect(takeoff).not.toHaveBeenCalled();
  });

  it("arms and takes off on the flight controller without a pilot", async () => {
    const { c, arm, takeoff } = ctx();
    await takeoffSkill.activate(c, { altitudeM: 7 });
    expect(arm).toHaveBeenCalledOnce();
    expect(takeoff).toHaveBeenCalledWith(7);
    expect(sent).toEqual([]);
  });

  it("falls back to the flight controller when the pilot stopped answering", async () => {
    pilotOn("fc_manual");
    useNavStreamStore.setState({ byDrone: { d1: { pilot: { data: null, receivedAt: Date.now() - 60_000 } } } as never });
    const { c, arm, takeoff } = ctx();
    await takeoffSkill.activate(c, { altitudeM: 7 });
    expect(sent).toEqual([]);
    expect(arm).toHaveBeenCalledOnce();
    expect(takeoff).toHaveBeenCalledWith(7);
  });
});
