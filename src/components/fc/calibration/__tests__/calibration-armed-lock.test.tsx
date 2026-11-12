/**
 * @license GPL-3.0-only
 *
 * Sensor calibration never starts on a vehicle that is armed or whose arm
 * state is unknown: the start controls are disabled with the arm-lock reason,
 * and every start path refuses before a command reaches the vehicle.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, render, screen, fireEvent } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

import { useCalibrationEngine } from "../useCalibrationEngine";
import { CalibrationWizard } from "../CalibrationWizard";
import { MspCalibrationSection } from "../MspCalibrationSection";

const LOCKED = "locked: disarm first";
const lock = { isHardBlocked: true };
const fw = { firmwareType: "ardupilot" as string };
const toast = vi.fn();

const ok = { success: true, resultCode: 0, message: "" };
const protocol = {
  onStatusText: vi.fn(() => () => {}),
  getParameter: vi.fn(async () => ({ value: 0 })),
  setParameter: vi.fn(async () => ({ success: true })),
  startCalibration: vi.fn(async () => ok),
  startGnssMagCal: vi.fn(async () => ok),
  getCalibrationData: vi.fn(async () => ({ accPositionFlags: 0, magZero: [0, 0, 0] as [number, number, number] })),
};

vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({
    isArmed: lock.isHardBlocked,
    isHardBlocked: lock.isHardBlocked,
    lockMessage: "",
    hardBlockMessage: lock.isHardBlocked ? LOCKED : "",
  }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel({}),
  selectSelectedProtocol: () => protocol,
}));
vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: fw.firmwareType }),
}));
vi.mock("../calibration-subscriptions", () => ({
  addSub: vi.fn(),
  cleanupSubs: vi.fn(),
  subscribeToCalibrationStatus: vi.fn(),
}));
vi.mock("../px4-cal-parser", () => ({ subscribePx4CalStatus: () => () => {} }));

const SENSOR_TYPES = ["accel", "gyro", "compass", "level", "airspeed", "baro", "esc", "compassmot"] as const;

beforeEach(() => {
  toast.mockReset();
  protocol.startCalibration.mockClear();
  protocol.startGnssMagCal.mockClear();
  protocol.setParameter.mockClear();
  fw.firmwareType = "ardupilot";
});

describe("useCalibrationEngine · arm lock", () => {
  it.each(SENSOR_TYPES)("refuses to start %s calibration while armed", async (type) => {
    lock.isHardBlocked = true;
    const { result } = renderHook(() => useCalibrationEngine(), { wrapper: IntlWrapper });
    expect(result.current.blockedReason).toBe(LOCKED);
    await act(async () => {
      await result.current.startCalibration(type, result.current.setAccel, 1);
    });
    expect(protocol.startCalibration).not.toHaveBeenCalled();
    expect(protocol.setParameter).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(LOCKED, "error");
  });

  it.each(SENSOR_TYPES)("starts %s calibration when disarmed", async (type) => {
    lock.isHardBlocked = false;
    const { result } = renderHook(() => useCalibrationEngine(), { wrapper: IntlWrapper });
    expect(result.current.blockedReason).toBeUndefined();
    await act(async () => {
      await result.current.startCalibration(type, result.current.setAccel, 1);
    });
    expect(protocol.startCalibration).toHaveBeenCalledWith(type);
  });

  it("refuses PX4 quick level and known-heading compass calibration while armed", async () => {
    lock.isHardBlocked = true;
    fw.firmwareType = "px4";
    const { result } = renderHook(() => useCalibrationEngine(), { wrapper: IntlWrapper });
    await act(async () => {
      await result.current.startPx4QuickLevel();
      await result.current.startPx4GnssMagCal(90);
    });
    expect(protocol.startCalibration).not.toHaveBeenCalled();
    expect(protocol.startGnssMagCal).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(2);
  });

  it("starts PX4 quick level and known-heading compass calibration when disarmed", async () => {
    lock.isHardBlocked = false;
    fw.firmwareType = "px4";
    const { result } = renderHook(() => useCalibrationEngine(), { wrapper: IntlWrapper });
    await act(async () => {
      await result.current.startPx4QuickLevel();
      await result.current.startPx4GnssMagCal(90);
    });
    expect(protocol.startCalibration).toHaveBeenCalledWith("level");
    expect(protocol.startGnssMagCal).toHaveBeenCalledWith(90);
  });
});

describe("CalibrationWizard · blockedReason", () => {
  const base = { title: "Accel", description: "d", steps: [], currentStep: 0, onStart: vi.fn(), onCancel: vi.fn() };

  it("disables Start and shows the lock reason", () => {
    render(<CalibrationWizard {...base} status="idle" blockedReason={LOCKED} />, { wrapper: IntlWrapper });
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(screen.getByText(LOCKED)).toBeInTheDocument();
  });

  it("disables Retry after an error", () => {
    render(<CalibrationWizard {...base} status="error" blockedReason={LOCKED} />, { wrapper: IntlWrapper });
    expect(screen.getByRole("button", { name: "Retry" })).toBeDisabled();
  });

  it("keeps Cancel usable for a calibration already running", () => {
    render(<CalibrationWizard {...base} status="in_progress" blockedReason={LOCKED} />, { wrapper: IntlWrapper });
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.queryByText(LOCKED)).toBeNull();
  });

  it("enables Start with no lock", () => {
    render(<CalibrationWizard {...base} status="idle" />, { wrapper: IntlWrapper });
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });
});

describe("MSP calibration · arm lock", () => {
  it("Betaflight accelerometer: Start disabled while armed", () => {
    lock.isHardBlocked = true;
    render(<MspCalibrationSection firmware="betaflight" />, { wrapper: IntlWrapper });
    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(protocol.startCalibration).not.toHaveBeenCalled();
  });

  it("iNav accelerometer and compass: start buttons disabled while armed", async () => {
    lock.isHardBlocked = true;
    render(<MspCalibrationSection firmware="inav" />, { wrapper: IntlWrapper });
    // Flags load asynchronously; the lock reason shows on both cards.
    expect(await screen.findAllByText(LOCKED)).toHaveLength(2);
    for (const button of screen.getAllByRole("button")) {
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(protocol.startCalibration).not.toHaveBeenCalled();
  });

  it("iNav start buttons enable once disarmed", async () => {
    lock.isHardBlocked = false;
    render(<MspCalibrationSection firmware="inav" />, { wrapper: IntlWrapper });
    await vi.waitFor(() => {
      for (const button of screen.getAllByRole("button")) expect(button).toBeEnabled();
    });
  });
});
