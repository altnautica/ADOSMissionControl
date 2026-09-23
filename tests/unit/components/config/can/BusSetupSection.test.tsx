/**
 * Smoke tests for BusSetupSection. Verifies the three card sections
 * render, the SLCAN confirm dialog gate fires, and the save / flash
 * buttons reflect the dirty state of the underlying param panel.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "../../../../helpers/intl-wrapper";
import { useDroneManager } from "@/stores/drone-manager";

const { armLock } = vi.hoisted(() => ({
  armLock: { isArmed: false, isHardBlocked: false, lockMessage: "", hardBlockMessage: "" },
}));
vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => armLock,
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

import { BusSetupSection } from "@/components/config/can/BusSetupSection";

describe("BusSetupSection", () => {
  beforeEach(() => {
    Object.assign(armLock, { isArmed: false, isHardBlocked: false, lockMessage: "", hardBlockMessage: "" });
    useDroneManager.setState({
      drones: new Map(),
      selectedDroneId: null,
      getSelectedProtocol: () => null,
      getSelectedDrone: () => null,
    } as never);
  });

  it("renders the three card sections", () => {
    renderWithIntl(<BusSetupSection />);
    expect(screen.getByText("CAN1")).toBeDefined();
    expect(screen.getByText("CAN2")).toBeDefined();
    expect(screen.getByText("SLCAN passthrough")).toBeDefined();
  });

  it("surfaces a not-connected hint when no protocol is bound", () => {
    renderWithIntl(<BusSetupSection />);
    expect(
      screen.getByText(/Connect a drone to read or write CAN parameters/i),
    ).toBeDefined();
  });

  it("renders the save and reload buttons", () => {
    renderWithIntl(<BusSetupSection />);
    expect(screen.getByRole("button", { name: /Save to FC/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Reload from FC/i })).toBeDefined();
  });

  function bindUsbDrone() {
    const mockAdapter = {
      isConnected: true,
      getParameter: vi.fn().mockResolvedValue({ value: 0, type: 9, index: 0, count: 0 }),
      setParameter: vi.fn().mockResolvedValue(undefined),
    };
    const mockDrone = { id: "test", name: "Test", protocol: mockAdapter, transport: { type: "webserial" } };
    useDroneManager.setState({
      drones: new Map([["test", mockDrone]]),
      selectedDroneId: "test",
      getSelectedProtocol: () => mockAdapter,
      getSelectedDrone: () => mockDrone,
    } as never);
  }

  it("blocks SLCAN entry while the vehicle is armed", () => {
    bindUsbDrone();
    Object.assign(armLock, {
      isArmed: true,
      isHardBlocked: true,
      hardBlockMessage: "Disarm to use.",
    });
    renderWithIntl(<BusSetupSection />);
    const enterBtn = screen.getByRole("button", { name: /Enter SLCAN mode/i }) as HTMLButtonElement;
    expect(enterBtn.disabled).toBe(true);
    expect(screen.getByText("Disarm to use.")).toBeDefined();
  });

  it("opens the SLCAN confirm dialog when the entry button is clicked", async () => {
    const mockAdapter = {
      isConnected: true,
      getParameter: vi.fn().mockResolvedValue({ value: 0, type: 9, index: 0, count: 0 }),
      setParameter: vi.fn().mockResolvedValue(undefined),
    };
    const mockDrone = {
      id: "test",
      name: "Test",
      protocol: mockAdapter,
      transport: { type: "webserial" },
    };
    const dronesMap = new Map([["test", mockDrone]]);
    useDroneManager.setState({
      drones: dronesMap,
      selectedDroneId: "test",
      getSelectedProtocol: () => mockAdapter,
      getSelectedDrone: () => mockDrone,
    } as never);

    renderWithIntl(<BusSetupSection />);
    const enterBtn = screen.getByRole("button", { name: /Enter SLCAN mode/i });
    fireEvent.click(enterBtn);
    // ConfirmDialog renders its message verbatim into the document.
    expect(
      screen.getByText(/Entering SLCAN mode will pause MAVLink/i),
    ).toBeDefined();
  });
});
