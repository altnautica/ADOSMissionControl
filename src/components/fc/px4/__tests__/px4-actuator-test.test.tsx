/**
 * @module fc/px4/px4-actuator-test.test
 * @description A PX4 actuator test the FC refuses is reported as refused,
 * never as a running motor.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CommandResult } from "@/lib/protocol/types";

const toast = vi.fn();
const actuatorTest = vi.fn<(fn: number, value: number, timeoutS: number) => Promise<CommandResult>>();

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/hooks/use-armed-lock", () => ({ useArmedLock: () => ({ isHardBlocked: false }) }));
const droneState = { drones: new Map([["d1", { protocol: { actuatorTest } }]]), selectedDroneId: "d1" };
vi.mock("@/stores/drone-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/stores/drone-manager")>()),
  useDroneManager: (selector: (s: unknown) => unknown) => selector(droneState),
}));

import { Px4ActuatorTest } from "../Px4ActuatorTest";

beforeEach(() => {
  toast.mockClear();
  actuatorTest.mockReset();
});

function start() {
  render(<Px4ActuatorTest connected />);
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("Px4ActuatorTest", () => {
  it("reports a denied test as refused, not as a spinning motor", async () => {
    actuatorTest.mockResolvedValue({ success: false, resultCode: 2, message: "Command denied" });
    start();
    fireEvent.click(screen.getByRole("button", { name: /Run/ }));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    const messages = toast.mock.calls.map(([m]) => String(m));
    expect(messages.some((m) => m.includes("Command denied"))).toBe(true);
    expect(messages.some((m) => m.startsWith("Testing"))).toBe(false);
  });

  it("warns that the output is running only after the FC accepts", async () => {
    actuatorTest.mockResolvedValue({ success: true, resultCode: 0, message: "ok" });
    start();
    fireEvent.click(screen.getByRole("button", { name: /Run/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringMatching(/^Testing Motor 1/), "warning"));
  });

  it("surfaces a refused Stop", async () => {
    actuatorTest.mockResolvedValue({ success: false, resultCode: 4, message: "Timed out" });
    start();
    fireEvent.click(screen.getByRole("button", { name: /Stop/ }));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("Timed out"), "error"));
  });
});
