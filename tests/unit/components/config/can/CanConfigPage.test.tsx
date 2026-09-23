/**
 * Smoke tests for CanConfigPage. Verifies the page renders with and
 * without a selected drone, and that the vertical section tabs route
 * between the three live sections.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../../../../helpers/intl-wrapper";
import { useDroneManager } from "@/stores/drone-manager";

vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: false, lockMessage: "" }),
}));

vi.mock("@/hooks/use-unsaved-guard", () => ({
  useUnsavedGuard: () => undefined,
}));

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-flash-commit-toast", () => ({
  useFlashCommitToast: () => vi.fn(),
}));

import { CanConfigPage } from "@/components/config/can/CanConfigPage";

describe("CanConfigPage", () => {
  beforeEach(() => {
    useDroneManager.setState({
      drones: new Map(),
      selectedDroneId: null,
      getSelectedProtocol: () => null,
      getSelectedDrone: () => null,
    } as never);
  });

  it("renders the page header and section tabs with no drone selected", () => {
    renderWithIntl(<CanConfigPage />);
    expect(screen.getByText("CAN Configuration")).toBeDefined();
    expect(screen.getByText("Bus setup")).toBeDefined();
    expect(screen.getByText("Node browser")).toBeDefined();
    expect(screen.getByText("Bus monitor")).toBeDefined();
  });

  it("surfaces a no-drone hint when no FC is connected", () => {
    renderWithIntl(<CanConfigPage />);
    expect(
      screen.getByText(/No drone selected/i),
    ).toBeDefined();
  });

  it("renders the bus-setup section by default", () => {
    renderWithIntl(<CanConfigPage />);
    // Section card title comes from canConfig.busSetup.can1Title.
    expect(screen.getByText("CAN1")).toBeDefined();
    expect(screen.getByText("CAN2")).toBeDefined();
  });

  it("switches to the node browser tab on click", () => {
    renderWithIntl(<CanConfigPage />);
    const tab = screen.getByRole("button", { name: /Node browser/i });
    fireEvent.click(tab);
    expect(screen.getByText("Detected DroneCAN nodes")).toBeDefined();
  });

  it("switches to the per-node params tab on click", () => {
    renderWithIntl(<CanConfigPage />);
    const tab = screen.getByRole("button", { name: /Per-node params/i });
    fireEvent.click(tab);
    expect(screen.getAllByText("Per-node params").length).toBeGreaterThan(0);
  });

  describe("DroneCAN session", () => {
    function withDrone() {
      const enableCanForward = vi.fn(async () => ({ success: true, resultCode: 0, message: "OK" }));
      const protocol = { enableCanForward, onCanFrame: () => () => {} };
      const drone = { id: "d1", protocol };
      useDroneManager.setState({
        drones: new Map([["d1", drone]]),
        selectedDroneId: "d1",
        getSelectedProtocol: () => protocol,
        getSelectedDrone: () => drone,
      } as never);
      return enableCanForward;
    }

    function fillInject() {
      fireEvent.click(screen.getByRole("button", { name: /Test utilities/i }));
      fireEvent.change(screen.getByPlaceholderText("0x18000000"), { target: { value: "0x123" } });
      fireEvent.change(screen.getByPlaceholderText("0011223344556677"), { target: { value: "0011223344556677" } });
      return screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    }

    it("gives the node tools a live bus only after the FC forwards it", async () => {
      const enableCanForward = withDrone();
      renderWithIntl(<CanConfigPage />);
      expect(fillInject().disabled).toBe(true);

      fireEvent.click(screen.getByRole("button", { name: "Open session" }));
      await waitFor(() => expect(screen.getByText(/Session open on bus 1/)).toBeDefined());
      expect(enableCanForward).toHaveBeenCalledWith(1);
      expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Close session" }));
      await waitFor(() => expect(enableCanForward).toHaveBeenLastCalledWith(0));
    });

    it("turns forwarding off when the page closes", async () => {
      const enableCanForward = withDrone();
      const { unmount } = renderWithIntl(<CanConfigPage />);
      fireEvent.click(screen.getByRole("button", { name: "Open session" }));
      await waitFor(() => expect(screen.getByText(/Session open on bus 1/)).toBeDefined());
      unmount();
      await waitFor(() => expect(enableCanForward).toHaveBeenLastCalledWith(0));
    });
  });
});
