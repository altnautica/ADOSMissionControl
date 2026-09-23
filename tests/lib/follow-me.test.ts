/**
 * Follow-me session behaviour: bound to one drone, never re-forcing the guided
 * mode after the first reposition, and ending itself when the followed drone
 * leaves the guided mode, refuses repositions, or when a preemptive skill runs.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { startFollowMe, stopFollowMe } from "@/lib/follow-me";
import { activate } from "@/lib/skills";
import { useSkillRegistry } from "@/lib/skills/registry";
import { useFollowMeStore } from "@/stores/follow-me-store";
import { useGcsLocationStore } from "@/stores/gcs-location-store";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import type { CommandResult, DroneProtocol, GuidedGotoOptions } from "@/lib/protocol/types";
import type { Skill, SkillContext, SkillState } from "@/lib/skills/types";
import type { FlightMode } from "@/lib/types";

const DRONE = "drone-f";
const ACCEPTED: CommandResult = { success: true, resultCode: 0, message: "Accepted" };
const DENIED: CommandResult = { success: false, resultCode: 2, message: "Denied" };

type GotoCall = [number, number, number, GuidedGotoOptions | undefined];

let replies: CommandResult[];
const guidedGoto = vi.fn(
  async (..._args: GotoCall): Promise<CommandResult> => replies.shift() ?? ACCEPTED,
);

function fcTelemetry(flightMode: FlightMode, relativeAlt = 40): void {
  useNodeRegistryStore.getState().updateFcTelemetry(DRONE, {
    armState: "armed",
    flightMode,
    position: {
      timestamp: Date.now(),
      lat: 10,
      lon: 20,
      alt: relativeAlt,
      relativeAlt,
      heading: 0,
      groundSpeed: 0,
      airSpeed: 0,
      climbRate: 0,
    },
  });
}

function gcsFix(accuracy = 5): void {
  useGcsLocationStore.setState({
    position: { lat: 10.001, lon: 20.001, accuracy, altitude: null, timestamp: Date.now() },
  });
}

/** Advance one send interval with fresh drone + GCS data, letting acks settle. */
async function tick(mode: FlightMode = "GUIDED"): Promise<void> {
  fcTelemetry(mode);
  gcsFix();
  await vi.advanceTimersByTimeAsync(250);
}

describe("follow-me session", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    replies = [];
    guidedGoto.mockClear();
    const protocol = {
      isConnected: true,
      guidedGoto,
      getVehicleInfo: () => ({ firmwareType: "ardupilot-copter" }),
      getFirmwareHandler: () => null,
      getCapabilities: () => ({}),
    } as unknown as DroneProtocol;
    useDroneManager.setState({
      selectedDroneId: DRONE,
      drones: new Map([[DRONE, { id: DRONE, name: "Alpha", protocol } as unknown as ManagedDrone]]),
    });
    useNodeRegistryStore.getState().clear();
    useNodeRegistryStore.getState().attachFc(DRONE, DRONE);
    fcTelemetry("LOITER");
    // An already-running watch: the test drives the fix itself.
    useGcsLocationStore.setState({ permission: "granted", position: null, watchId: 1 });
    expect(await startFollowMe(DRONE)).toEqual({ ok: true });
  });

  afterEach(() => {
    stopFollowMe();
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
    useNodeRegistryStore.getState().clear();
    vi.useRealTimers();
  });

  it("binds the session to the drone it was started on", () => {
    const s = useFollowMeStore.getState();
    expect(s.isActive).toBe(true);
    expect(s.droneId).toBe(DRONE);
    expect(s.droneName).toBe("Alpha");
  });

  it("reports accuracy as unknown until the first GCS fix", async () => {
    expect(useFollowMeStore.getState().gcsAccuracy).toBeNull();
    await tick("LOITER");
    expect(useFollowMeStore.getState().gcsAccuracy).toBe(5);
  });

  it("refuses a second start with its reason", async () => {
    expect(await startFollowMe(DRONE)).toEqual({
      ok: false,
      reason: "a follow-me session is already running",
    });
  });

  it("names a refused location permission instead of failing silently", async () => {
    stopFollowMe();
    useGcsLocationStore.setState({
      permission: "denied",
      requestPermission: async () => "denied",
    });
    const result = await startFollowMe(DRONE);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.reason).toMatch(/location permission/);
    expect(useFollowMeStore.getState().isActive).toBe(false);
  });

  it("asks for the mode change on the first reposition only", async () => {
    await tick("LOITER");
    await tick("GUIDED");
    expect(guidedGoto).toHaveBeenCalledTimes(2);
    expect(guidedGoto.mock.calls[0][3]).toEqual({ changeMode: true });
    expect(guidedGoto.mock.calls[1][3]).toEqual({ changeMode: false });
    // The altitude floor is the followed drone's own height, not a constant.
    expect(guidedGoto.mock.calls[1][2]).toBe(40);
  });

  it("does not send a GCS fix taken before the session started", async () => {
    useGcsLocationStore.setState({
      position: { lat: 1, lon: 1, accuracy: 5, altitude: null, timestamp: Date.now() - 1000 },
    });
    fcTelemetry("GUIDED");
    await vi.advanceTimersByTimeAsync(250);
    expect(guidedGoto).not.toHaveBeenCalled();
  });

  it("stops within one tick when the drone leaves GUIDED", async () => {
    await tick("LOITER");
    await tick("GUIDED");
    const sent = guidedGoto.mock.calls.length;

    await tick("RTL");

    expect(useFollowMeStore.getState().isActive).toBe(false);
    expect(guidedGoto).toHaveBeenCalledTimes(sent);
    await tick("RTL");
    expect(guidedGoto).toHaveBeenCalledTimes(sent);
  });

  it("stops after three repositions in a row are not accepted", async () => {
    replies = [DENIED, DENIED];
    await tick("LOITER");
    await tick("LOITER");
    expect(useFollowMeStore.getState().isActive).toBe(true);

    replies = [DENIED];
    await tick("LOITER");
    expect(useFollowMeStore.getState().isActive).toBe(false);
  });

  it("stops when another drone is selected", async () => {
    await tick("GUIDED");
    useDroneManager.setState({ selectedDroneId: "drone-other" });
    await tick("GUIDED");
    expect(useFollowMeStore.getState().isActive).toBe(false);
  });

  it("stops when the followed drone disarms", async () => {
    await tick("GUIDED");
    useNodeRegistryStore.getState().updateFcTelemetry(DRONE, { armState: "disarmed" });
    gcsFix();
    await vi.advanceTimersByTimeAsync(250);
    expect(useFollowMeStore.getState().isActive).toBe(false);
  });

  it("stops when the GCS fix goes stale", async () => {
    await tick("GUIDED");
    for (let i = 0; i < 24; i++) {
      fcTelemetry("GUIDED");
      await vi.advanceTimersByTimeAsync(250);
    }
    expect(useFollowMeStore.getState().isActive).toBe(false);
  });

  it("is ended by activate('rth') on the same drone before RTH runs", async () => {
    await tick("GUIDED");
    expect(useFollowMeStore.getState().isActive).toBe(true);
    let activeWhenRthRan: boolean | null = null;
    const rth: Skill = {
      id: "rth",
      label: "skills.rth",
      icon: "Home",
      category: "flight",
      source: "builtin",
      toggle: false,
      getState: () => ({ kind: "idle" }) as SkillState,
      activate: async () => {
        activeWhenRthRan = useFollowMeStore.getState().isActive;
      },
    };
    useSkillRegistry.getState().register(rth);
    const ctx: SkillContext = {
      droneId: DRONE,
      protocol: null,
      armState: "armed",
      flightMode: "GUIDED",
      availableModes: [],
      previousMode: "LOITER",
      supports: () => true,
      checklistReady: true,
      confirm: async () => true,
      notify: () => {},
    };

    await activate("rth", ctx);

    expect(activeWhenRthRan).toBe(false);

    useSkillRegistry.getState().unregister("rth");
  });
});
