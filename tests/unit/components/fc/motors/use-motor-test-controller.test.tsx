/**
 * The bench motor test must end itself: leaving the panel, switching or
 * losing the drone, or arming all send the all-idle frame, and every motor
 * command travels in one frame so raising one motor never idles another.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMotorTestController } from "@/components/fc/motors/use-motor-test-controller";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import type { DroneProtocol } from "@/lib/protocol/types";

function fakeProtocol() {
  const frames: number[][] = [];
  const protocol = {
    setMotorTestOutputs: vi.fn(async (throttles: readonly number[]) => {
      frames.push([...throttles]);
      return { success: true, resultCode: 0, message: "ok" };
    }),
  } as unknown as DroneProtocol;
  return { protocol, frames };
}

function selectDrone(id: string, protocol: DroneProtocol) {
  const drones = new Map(useDroneManager.getState().drones);
  drones.set(id, { id, protocol } as ManagedDrone);
  useDroneManager.setState({ drones, selectedDroneId: id });
}

/** The FC reports four driven motors at idle (unused slots read 0). */
function reportFourMotors() {
  useTelemetryStore.getState().pushServoOutput({
    timestamp: Date.now(), port: 0, servos: [1000, 1000, 1000, 1000, 0, 0, 0, 0],
  });
}

const isIdle = (frame: number[] | undefined) => !!frame && frame.every((v) => v === 0);

async function startSpinning() {
  const { protocol, frames } = fakeProtocol();
  selectDrone("d1", protocol);
  const hook = renderHook(() => useMotorTestController());
  act(() => {
    expect(hook.result.current.enable()).toBe(true);
  });
  await act(async () => {
    hook.result.current.setMotor(1, 30);
  });
  expect(frames.at(-1)?.[1]).toBe(30);
  return { hook, frames };
}

describe("useMotorTestController", () => {
  beforeEach(() => {
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    useTelemetryStore.getState().clear();
    reportFourMotors();
  });

  it("sends every motor in one frame, so raising one keeps the others", async () => {
    const { hook, frames } = await startSpinning();
    await act(async () => {
      hook.result.current.setMotor(2, 45);
    });
    expect(frames.at(-1)?.slice(0, 4)).toEqual([0, 30, 45, 0]);
    await act(async () => {
      hook.result.current.setAll(20);
    });
    expect(frames.at(-1)?.slice(0, 5)).toEqual([20, 20, 20, 20, 0]);
  });

  it("idles every output when the panel unmounts", async () => {
    const { hook, frames } = await startSpinning();
    hook.unmount();
    expect(isIdle(frames.at(-1))).toBe(true);
  });

  it("idles the old drone when the selection changes", async () => {
    const { hook, frames } = await startSpinning();
    const other = fakeProtocol();
    act(() => selectDrone("d2", other.protocol));
    expect(isIdle(frames.at(-1))).toBe(true);
    expect(hook.result.current.active).toBe(false);
    expect(other.frames).toHaveLength(0);
  });

  it("idles and ends the test when the drone disconnects", async () => {
    const { hook, frames } = await startSpinning();
    act(() => useDroneManager.setState({ drones: new Map(), selectedDroneId: null }));
    expect(isIdle(frames.at(-1))).toBe(true);
    expect(hook.result.current.active).toBe(false);
  });

  it("idles and ends the test when the aircraft arms", async () => {
    const { hook, frames } = await startSpinning();
    act(() => useDroneStore.setState({ armState: "armed" }));
    expect(isIdle(frames.at(-1))).toBe(true);
    expect(hook.result.current.active).toBe(false);
  });

  it("shows the FC's reported output, not the commanded value", async () => {
    const { hook } = await startSpinning();
    expect(hook.result.current.reported[1]).toBe(0);
    act(() => {
      useTelemetryStore.getState().pushServoOutput({
        timestamp: Date.now(), port: 0, servos: [1000, 1250, 1000, 1000, 0, 0, 0, 0],
      });
      useTelemetryStore.setState((s) => ({ _version: s._version + 1 }));
    });
    expect(hook.result.current.motorCount).toBe(4);
    expect(hook.result.current.reported[1]).toBe(25);
  });
});
