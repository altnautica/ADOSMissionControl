/**
 * @license GPL-3.0-only
 *
 * Bus setup › Reboot FC sends nothing unless the vehicle is known disarmed
 * when the operator confirms: an unknown arm state may be airborne, and a
 * vehicle that arms with the confirmation open cannot be rebooted from it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { fireEvent, render, screen } from "@testing-library/react";

import messages from "../../../../../locales/en.json";
import { BusSetupSection } from "../BusSetupSection";

const sendCommand = vi.fn(async () => ({ success: true, message: "" }));
const protocol = { sendCommand };

vi.mock("@/hooks/use-fc-panel-state", () => ({
  useFcPanelState: () => ({
    params: new Map<string, number>(),
    loading: false,
    error: null,
    dirtyParams: new Set<string>(["CAN_SLCAN_CPORT"]),
    hasRamWrites: false,
    hasLoaded: true,
    getProtocol: () => protocol,
    missingOptional: new Set<string>(),
    refresh: vi.fn(),
    setLocalValue: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-param-panel-actions", () => ({
  useParamPanelActions: () => ({ saving: false, save: vi.fn(), flash: vi.fn() }),
}));
const arm = { state: "disarmed", hardBlocked: false };
vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isHardBlocked: arm.hardBlocked, hardBlockMessage: "Disarm first" }),
}));
vi.mock("@/lib/protocol/transport/slcan-flash-arbiter", () => ({
  enterSlcanMode: vi.fn(),
  SLCAN_TIMEOUT_MAX_S: 100,
}));
vi.mock("@/stores/drone-manager", () => {
  const s = { selectedDroneId: null, drones: new Map(), getSelectedDrone: () => null };
  const hook = (sel: (x: typeof s) => unknown) => sel(s);
  hook.getState = () => s;
  return { useDroneManager: hook };
});
vi.mock("@/stores/drone-store", () => ({
  useDroneStore: { getState: () => ({ armState: arm.state, connectionState: "connected" }) },
}));
vi.mock("@/stores/slcan-mode-store", () => ({
  useSlcanModeStore: (sel: (x: { state: string }) => unknown) => sel({ state: "idle" }),
}));

function renderSection() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BusSetupSection />
    </NextIntlClientProvider>,
  );
}

describe("BusSetupSection · Reboot FC arm checks", () => {
  beforeEach(() => {
    sendCommand.mockClear();
    arm.state = "disarmed";
    arm.hardBlocked = false;
  });

  function openConfirm() {
    const view = renderSection();
    fireEvent.click(screen.getByRole("button", { name: messages.canConfig.busSetup.rebootFc }));
    return view;
  }
  const confirmButton = () => {
    const buttons = screen.getAllByRole("button", { name: messages.parameters.rebootConfirmLabel });
    return buttons[buttons.length - 1] as HTMLButtonElement;
  };

  it("sends nothing when the arm state turned unknown before confirming", async () => {
    openConfirm();
    arm.state = "unknown";
    fireEvent.click(confirmButton());
    await new Promise((r) => setTimeout(r, 0));
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("cannot be confirmed once the vehicle may be armed", () => {
    const { rerender } = openConfirm();
    arm.state = "armed";
    arm.hardBlocked = true;
    rerender(
      <NextIntlClientProvider locale="en" messages={messages}>
        <BusSetupSection />
      </NextIntlClientProvider>,
    );
    expect(confirmButton().disabled).toBe(true);
  });
});
