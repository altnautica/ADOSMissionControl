/**
 * @module fc/misc/servo-calibration-test.test
 * @description The endpoint "Test" button reports what the FC answered: a
 * refused DO_SET_SERVO is not toasted as set.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { CommandResult } from "@/lib/protocol/types";

const toast = vi.fn();
const setServo = vi.fn<(servo: number, pwm: number) => Promise<CommandResult>>();

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/hooks/use-flash-commit-toast", () => ({ useFlashCommitToast: () => ({ showFlashResult: vi.fn() }) }));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));
vi.mock("@/hooks/use-armed-lock", () => ({ useArmedLock: () => ({ isHardBlocked: false, hardBlockMessage: "" }) }));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map<string, number>(), loading: false, dirtyParams: new Set<string>(), hasRamWrites: false,
    hasLoaded: true, refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash: vi.fn(),
  }),
}));
const droneState = { getSelectedProtocol: () => ({ setServo }) };
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (selector: (s: unknown) => unknown) => selector(droneState),
}));
const telemetryState = { servoOutput: { latest: () => undefined }, _version: 0 };
vi.mock("@/stores/telemetry-store", () => ({
  useTelemetryStore: (selector: (s: unknown) => unknown) => selector(telemetryState),
}));

import { ServoCalibrationSection } from "../ServoCalibrationSection";

beforeEach(() => {
  toast.mockClear();
  setServo.mockReset();
});

async function testServo3() {
  render(<ServoCalibrationSection />);
  fireEvent.click(screen.getByRole("switch"));
  fireEvent.click(screen.getByText("SERVO3"));
  fireEvent.click(screen.getByRole("button", { name: /Test/ }));
  await waitFor(() => expect(toast).toHaveBeenCalled());
  return toast.mock.calls.map(([m, level]) => [String(m), level]);
}

describe("ServoCalibrationSection output test", () => {
  it("reports a refused servo command instead of 'set'", async () => {
    setServo.mockResolvedValue({ success: false, resultCode: 2, message: "Command denied" });
    const calls = await testServo3();
    expect(calls).toContainEqual([expect.stringContaining("Command denied"), "error"]);
    expect(calls.some(([m]) => m === "Servo 3 set to 1500")).toBe(false);
  });

  it("confirms the value only after the FC accepts it", async () => {
    setServo.mockResolvedValue({ success: true, resultCode: 0, message: "ok" });
    expect(await testServo3()).toContainEqual(["Servo 3 set to 1500", "info"]);
  });
});
