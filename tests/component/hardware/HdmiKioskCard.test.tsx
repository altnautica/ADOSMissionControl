/**
 * @module HdmiKioskCard.test
 * @description The kiosk card's touch-calibration flow against the agent's
 * status shape: `requested` while the display service has not picked the
 * request up, `calibrated` once a fit is stored. No step counter exists.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";

vi.mock("lucide-react", () => ({
  __esModule: true,
  MonitorPlay: () => null,
  Loader2: () => null,
}));

const mockClient = {
  getConfig: vi.fn().mockResolvedValue({}),
  setConfigValue: vi.fn().mockResolvedValue({ status: "ok" }),
  startTouchCalibration: vi.fn(),
  getTouchCalibrationStatus: vi.fn(),
};

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ client: mockClient, nodeDeviceId: "gs-1" }),
}));

const toastFn = vi.fn();
vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));

import { HdmiKioskCard } from "@/components/hardware/HdmiKioskCard";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";

const initial = useAgentCapabilitiesStore.getState();

/** Flush the resolved client promises and one poll tick. */
async function tick(ms = 1000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  toastFn.mockClear();
  mockClient.startTouchCalibration.mockReset().mockResolvedValue({ requested: true, target_count: 9 });
  mockClient.getTouchCalibrationStatus.mockReset();
  useAgentCapabilitiesStore.setState({ ...initial, loaded: true, displayType: "hdmi" }, true);
});

afterEach(() => {
  vi.useRealTimers();
  useAgentCapabilitiesStore.setState(initial, true);
});

describe("HdmiKioskCard touch calibration", () => {
  it("finishes when an uncalibrated panel stores its first fit", async () => {
    mockClient.getTouchCalibrationStatus
      .mockResolvedValueOnce({ calibrated: false, requested: false }) // seed
      .mockResolvedValueOnce({ calibrated: false, requested: true }) // queued
      .mockResolvedValueOnce({ calibrated: false, requested: false }) // wizard on the panel
      .mockResolvedValue({ calibrated: true, requested: false }); // fit saved
    renderWithIntl(<HdmiKioskCard nodeDeviceId="gs-1" relayReach={null} />);
    await tick(0);
    expect(screen.getByText("Not calibrated")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /calibrate touch/i }));
    await tick(0);
    expect(screen.getByText(/Wizard requested/)).toBeTruthy();

    await tick();
    expect(toastFn).not.toHaveBeenCalledWith("Calibration complete.", "success");
    await tick();

    expect(toastFn).toHaveBeenCalledWith("Calibration complete.", "success");
    expect(screen.getByText("Calibrated")).toBeTruthy();
    expect(screen.queryByText(/Wizard requested/)).toBeNull();
  });

  it("hands off to the panel when it already had a fit", async () => {
    mockClient.getTouchCalibrationStatus
      .mockResolvedValueOnce({ calibrated: true, requested: false }) // seed
      .mockResolvedValueOnce({ calibrated: true, requested: true }) // queued
      .mockResolvedValue({ calibrated: true, requested: false }); // taken by the panel
    renderWithIntl(<HdmiKioskCard nodeDeviceId="gs-1" relayReach={null} />);
    await tick(0);

    fireEvent.click(screen.getByRole("button", { name: /calibrate touch/i }));
    await tick(0);
    await tick();

    expect(toastFn).toHaveBeenCalledWith(
      "The wizard is open on the HDMI panel. The new fit is saved when you finish tapping.",
      "info",
    );
    expect(toastFn).not.toHaveBeenCalledWith("Calibration complete.", "success");
  });

  it("warns when the panel never picks the request up", async () => {
    mockClient.getTouchCalibrationStatus
      .mockResolvedValueOnce({ calibrated: false, requested: false })
      .mockResolvedValue({ calibrated: false, requested: true });
    renderWithIntl(<HdmiKioskCard nodeDeviceId="gs-1" relayReach={null} />);
    await tick(0);

    fireEvent.click(screen.getByRole("button", { name: /calibrate touch/i }));
    await tick(0);
    await tick(181_000);

    expect(toastFn).toHaveBeenCalledWith(
      "The HDMI panel did not open the wizard. Check that its display service is running.",
      "warning",
    );
    expect(screen.queryByText(/Wizard requested/)).toBeNull();
  });
});
