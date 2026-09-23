/**
 * ArduPilot emits CAN_FRAME only while a GCS has forwarding enabled, so the
 * CAN monitor's Start must ask the flight controller for it and show
 * "Capturing" only after the FC accepted. Stop turns forwarding back off, and
 * the frame rate falls to 0 once frames stop instead of freezing.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";
import { useCanMonitorStore } from "@/stores/can-monitor-store";

const h = vi.hoisted(() => ({ enableCanForward: vi.fn(), toast: vi.fn() }));

vi.mock("@/stores/drone-manager", () => {
  const protocol = { isConnected: true, enableCanForward: h.enableCanForward };
  return {
    useDroneManager: (sel: (s: unknown) => unknown) => sel({ getSelectedProtocol: () => protocol }),
  };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: h.toast }) }));

import { CanMonitorPanel } from "@/components/fc/can/CanMonitorPanel";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useCanMonitorStore.getState().setEnabled(false);
});

describe("CanMonitorPanel forwarding", () => {
  it("enables forwarding on the FC before capturing, and disables it on Stop", async () => {
    h.enableCanForward.mockResolvedValue({ success: true, resultCode: 0, message: "ok" });
    renderWithIntl(<CanMonitorPanel />);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Start/ })); });
    expect(h.enableCanForward).toHaveBeenCalledWith(1);
    expect(useCanMonitorStore.getState().enabled).toBe(true);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Capturing/ })); });
    expect(h.enableCanForward).toHaveBeenLastCalledWith(0);
    expect(useCanMonitorStore.getState().enabled).toBe(false);
  });

  it("stays stopped when the FC refuses forwarding", async () => {
    h.enableCanForward.mockResolvedValue({ success: false, resultCode: 4, message: "denied" });
    renderWithIntl(<CanMonitorPanel />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Start/ })); });
    expect(useCanMonitorStore.getState().enabled).toBe(false);
    expect(screen.queryByText(/Capturing/)).toBeNull();
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining("refused"), "error");
  });

  it("shows 0 frames/sec once frames stop", () => {
    act(() => {
      useCanMonitorStore.setState({ enabled: true, framesPerSecond: 850, _lastTallyAt: Date.now() - 10_000 });
    });
    const { container } = renderWithIntl(<CanMonitorPanel />);
    expect(container.textContent).not.toContain("850");
  });
});
