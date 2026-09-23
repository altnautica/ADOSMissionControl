/**
 * @license GPL-3.0-only
 *
 * The pre-arm panel may say "All checks passed" only on evidence from the
 * flight controller: over MSP the decoded arming-disable word, over MAVLink
 * the fresh SYS_STATUS pre-arm bit. A refused or failed request is a failure,
 * a request that throws still ends the check, and PX4's "Preflight Fail:"
 * STATUSTEXT is collected alongside ArduPilot's "PreArm:".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { PreArmChecks } from "@/components/indicators/PreArmChecks";
import type { CommandResult, DroneProtocol } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useSensorHealthStore } from "@/stores/sensor-health-store";

const PREARM_BIT = 1 << 28;
const ALL_PASSED = "All checks passed";

type StatusTextListener = (d: { severity: number; text: string }) => void;

function mountProtocol(
  protocolName: string,
  doPreArmCheck: () => Promise<CommandResult>,
): { emitStatusText: (text: string) => void } {
  const listeners: StatusTextListener[] = [];
  const protocol = {
    protocolName,
    doPreArmCheck,
    onStatusText: (cb: StatusTextListener) => {
      listeners.push(cb);
      return () => undefined;
    },
  } as unknown as DroneProtocol;
  useDroneManager.setState({
    drones: new Map([["d1", { id: "d1", protocol } as unknown as ManagedDrone]]),
    selectedDroneId: "d1",
  });
  return { emitStatusText: (text) => listeners.forEach((cb) => cb({ severity: 3, text })) };
}

async function runCheck(windowMs = 3_000): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /run check/i }));
  });
  await act(async () => {
    vi.advanceTimersByTime(windowMs);
  });
}

describe("PreArmChecks verdict", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSensorHealthStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  });

  it("shows an MSP arming refusal as a failure, never as a pass", async () => {
    mountProtocol("msp", async () => ({
      success: false,
      resultCode: -1,
      message: "Arming blocked: RX failsafe, Craft not level",
    }));
    const { container } = renderWithIntl(<PreArmChecks />);
    await runCheck();

    expect(container.textContent).toContain("Arming blocked: RX failsafe, Craft not level");
    expect(container.textContent).not.toContain(ALL_PASSED);
  });

  it("does not claim a MAVLink pass without the FC's pre-arm verdict", async () => {
    mountProtocol("mavlink", async () => ({ success: true, resultCode: 0, message: "Accepted" }));
    const { container } = renderWithIntl(<PreArmChecks />);
    await runCheck();

    expect(container.textContent).not.toContain(ALL_PASSED);
    expect(container.textContent).toContain("No failures reported");
  });

  it("passes a MAVLink check when the FC's pre-arm bit is fresh and healthy", async () => {
    mountProtocol("mavlink", async () => ({ success: true, resultCode: 0, message: "Accepted" }));
    const { container } = renderWithIntl(<PreArmChecks />);
    useSensorHealthStore.getState().updateFromSysStatus(PREARM_BIT, PREARM_BIT, PREARM_BIT);
    await runCheck();

    expect(container.textContent).toContain(ALL_PASSED);
  });

  it("shows a denied or unacknowledged MAVLink request as a failure", async () => {
    mountProtocol("mavlink", async () => ({ success: false, resultCode: 4, message: "Command denied" }));
    const { container } = renderWithIntl(<PreArmChecks />);
    await runCheck();

    expect(container.textContent).toContain("Command denied");
    expect(container.textContent).not.toContain(ALL_PASSED);
  });

  it("collects PX4 Preflight Fail messages", async () => {
    const fc = mountProtocol("mavlink", async () => ({ success: true, resultCode: 0, message: "Accepted" }));
    const { container } = renderWithIntl(<PreArmChecks />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /run check/i }));
    });
    act(() => fc.emitStatusText("Preflight Fail: Battery unhealthy"));
    await act(async () => {
      vi.advanceTimersByTime(3_000);
    });

    expect(container.textContent).toContain("Battery unhealthy");
    expect(container.textContent).not.toContain(ALL_PASSED);
  });

  it("ends the check when the request throws", async () => {
    mountProtocol("mavlink", async () => {
      throw new Error("link lost");
    });
    const { container } = renderWithIntl(<PreArmChecks />);
    await runCheck(0);

    expect(container.textContent).toContain("link lost");
    expect(
      (screen.getByRole("button", { name: /run check/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
