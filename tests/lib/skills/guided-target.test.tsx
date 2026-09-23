/**
 * Land Here and the guided-target supervisor: the land command goes out only
 * once the vehicle is holding over the point, the sequence ends without
 * landing on a mode change, a timeout or an operator cancel, and the overlay's
 * cancel commands the vehicle to hold instead of only hiding the target.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/skills", async () => {
  const actual = await vi.importActual<typeof import("@/lib/skills")>("@/lib/skills");
  return { ...actual, activate: vi.fn(() => Promise.resolve()) };
});

import { activate } from "@/lib/skills";
import {
  GUIDED_POLL_MS,
  LAND_REPOSITION_TIMEOUT_MS,
  cancelGuidedTarget,
  landAtPoint,
  superviseGuidedTarget,
} from "@/lib/skills/guided-target";
import { GuidedTargetOverlay } from "@/components/flight/GuidedTargetOverlay";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useGuidedStore } from "@/stores/guided-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import type { DroneProtocol } from "@/lib/protocol/types";

const DRONE = "drone-1";
const TARGET = { lat: 47.0, lon: 8.0 };
/** About 1.1 m of latitude. */
const ONE_METRE_DEG = 1e-5;

const ok = { success: true, resultCode: 0, message: "" };
const guidedGoto = vi.fn(async () => ok);
const land = vi.fn(async () => ok);
const protocol = {
  guidedGoto,
  land,
  getVehicleInfo: () => ({ firmwareType: "ardupilot-copter" }),
} as unknown as DroneProtocol;
const report = vi.fn();

/** A fresh position `metresNorth` of the target moving at `groundSpeed`. */
function at(metresNorth: number, groundSpeed: number): void {
  useTelemetryStore.getState().pushPosition({
    timestamp: Date.now(),
    lat: TARGET.lat + metresNorth * ONE_METRE_DEG,
    lon: TARGET.lon,
    alt: 10,
    relativeAlt: 10,
    heading: 0,
    groundSpeed,
    airSpeed: groundSpeed,
    climbRate: 0,
  });
}

async function tick(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(GUIDED_POLL_MS);
  });
}

async function startLandHere(): Promise<void> {
  await landAtPoint({ protocol, droneId: DRONE, ...TARGET, alt: 10, report });
}

beforeEach(() => {
  vi.useFakeTimers();
  guidedGoto.mockClear();
  land.mockClear();
  report.mockClear();
  (activate as unknown as ReturnType<typeof vi.fn>).mockClear();
  useTelemetryStore.getState().clear();
  useDroneManager.setState({ selectedDroneId: DRONE });
  useDroneStore.setState({ flightMode: "GUIDED" });
});

afterEach(() => {
  cancelGuidedTarget();
  cleanup();
  vi.useRealTimers();
  useDroneManager.setState({ selectedDroneId: null });
});

describe("Land Here", () => {
  it("repositions first and lands only once within 2 m and below 1 m/s", async () => {
    await startLandHere();
    expect(guidedGoto).toHaveBeenCalledWith(TARGET.lat, TARGET.lon, 10);
    expect(land).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith("Repositioning to land point", "info");
    expect(useGuidedStore.getState().target?.purpose).toBe("land");

    at(60, 5);
    await tick();
    at(1.5, 3); // over the point but still moving
    await tick();
    at(3, 0.2); // holding, but outside the radius
    await tick();
    expect(land).not.toHaveBeenCalled();

    at(1.5, 0.4);
    await tick();
    expect(land).toHaveBeenCalledTimes(1);
    expect(land).toHaveBeenCalledWith(TARGET);
    expect(report).toHaveBeenLastCalledWith("Landing at the selected point", "success");
    expect(useGuidedStore.getState().target).toBeNull();
  });

  it("does not land when the reposition is rejected", async () => {
    guidedGoto.mockResolvedValueOnce({ success: false, resultCode: 4, message: "denied" });
    await startLandHere();
    at(0, 0);
    await tick();
    expect(land).not.toHaveBeenCalled();
    expect(useGuidedStore.getState().target).toBeNull();
  });

  it("ends without landing when the mode leaves GUIDED", async () => {
    await startLandHere();
    at(40, 4);
    await tick();
    useDroneStore.setState({ flightMode: "RTL" });
    at(0.5, 0.1);
    await tick();
    await tick();
    expect(land).not.toHaveBeenCalled();
    expect(useGuidedStore.getState().target).toBeNull();
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining("cancelled"), "warning");
  });

  it("gives up without landing after 180 s", async () => {
    await startLandHere();
    for (let t = 0; t < LAND_REPOSITION_TIMEOUT_MS; t += GUIDED_POLL_MS) {
      at(30, 2);
      await tick();
    }
    at(0.5, 0.1);
    await tick();
    expect(land).not.toHaveBeenCalled();
    expect(useGuidedStore.getState().target).toBeNull();
    expect(report).toHaveBeenLastCalledWith(expect.stringContaining("cancelled"), "warning");
  });

  it("never lands after the operator cancels", async () => {
    await startLandHere();
    cancelGuidedTarget();
    at(0.5, 0.1);
    await tick();
    expect(land).not.toHaveBeenCalled();
  });
});

describe("guided target overlay", () => {
  it("clears a Fly Here target once the vehicle leaves GUIDED", async () => {
    superviseGuidedTarget(
      { droneId: DRONE, ...TARGET, alt: 10, timestamp: Date.now(), purpose: "goto" },
      protocol,
      report,
    );
    at(80, 5);
    await tick();
    expect(useGuidedStore.getState().target).not.toBeNull();
    useDroneStore.setState({ flightMode: "LOITER" });
    await tick();
    expect(useGuidedStore.getState().target).toBeNull();
  });

  it("cancel commands a hold through the dispatcher and stops the land sequence", async () => {
    await startLandHere();
    at(50, 5);
    render(<GuidedTargetOverlay />);
    expect(screen.getByText("Repositioning to land point")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /hold position/ }));
    expect(activate).toHaveBeenCalledTimes(1);
    expect((activate as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("pause");

    at(0.5, 0.1);
    await tick();
    expect(land).not.toHaveBeenCalled();
  });

  it("does not show another drone's target", () => {
    superviseGuidedTarget(
      { droneId: "drone-2", ...TARGET, alt: 10, timestamp: Date.now(), purpose: "goto" },
      protocol,
      report,
    );
    at(50, 5);
    render(<GuidedTargetOverlay />);
    expect(screen.queryByText("Flying to target")).toBeNull();
  });
});
