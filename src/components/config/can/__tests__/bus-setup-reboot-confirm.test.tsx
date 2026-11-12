/**
 * @license GPL-3.0-only
 *
 * Bus setup › Reboot FC asks for confirmation before it sends the reboot
 * command, and Cancel sends nothing.
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
vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isHardBlocked: false, hardBlockMessage: "" }),
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
  useDroneStore: { getState: () => ({ armState: "disarmed" }) },
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

describe("BusSetupSection · Reboot FC", () => {
  beforeEach(() => sendCommand.mockClear());

  it("opens a confirm dialog and sends nothing until confirmed", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: messages.canConfig.busSetup.rebootFc }));
    expect(sendCommand).not.toHaveBeenCalled();
    expect(screen.getByText(messages.parameters.rebootMessage)).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: messages.parameters.rebootConfirmLabel });
    fireEvent.click(buttons[buttons.length - 1]);
    await vi.waitFor(() => expect(sendCommand).toHaveBeenCalledWith(246, [1, 0, 0, 0, 0, 0, 0]));
  });

  it("Cancel sends nothing", () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: messages.canConfig.busSetup.rebootFc }));
    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));
    expect(sendCommand).not.toHaveBeenCalled();
  });
});
