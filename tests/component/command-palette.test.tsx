/**
 * The global command palette's flight commands go through the same gates as
 * every other surface: Arm opens the skill dispatcher's typed confirm (and
 * never reaches the protocol on its own), and Return to Home All asks before
 * recalling the fleet.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../locales/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

const returnFleetToLaunch = vi.fn(
  async (): Promise<FleetCommandOutcome> => ({ attempted: 1, acknowledged: ["Alpha"], failures: [] }),
);
vi.mock("@/lib/fleet-commands", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fleet-commands")>(
    "@/lib/fleet-commands",
  );
  return { ...actual, returnFleetToLaunch: () => returnFleetToLaunch() };
});

import { CommandPalette } from "@/components/shared/command-palette";
import { registerBuiltins } from "@/lib/skills";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import type { DroneProtocol } from "@/lib/protocol/types";
import type { FleetCommandOutcome } from "@/lib/fleet-commands";

const DRONE = "drone-1";
const arm = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));

function seedDrone(): void {
  const protocol = {
    isConnected: true,
    arm,
    getFirmwareHandler: () => null,
    getCapabilities: () => ({}),
    getCachedParameterNames: () => [],
  } as unknown as DroneProtocol;
  const drones = new Map([[DRONE, { id: DRONE, protocol } as unknown as ManagedDrone]]);
  useDroneManager.setState({ drones, selectedDroneId: DRONE });
  useDroneStore.setState({ armState: "disarmed" });
}

function openPalette(): void {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CommandPalette />
    </NextIntlClientProvider>,
  );
  act(() => {
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  });
}

describe("CommandPalette flight commands", () => {
  beforeEach(() => {
    registerBuiltins();
    seedDrone();
    arm.mockClear();
    returnFleetToLaunch.mockClear();
  });
  afterEach(() => {
    act(() => useSkillConfirmStore.getState().resolvePending(false));
    cleanup();
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  });

  it("Arm Drone opens the arm skill's confirm and never arms on its own", async () => {
    openPalette();
    await act(async () => {
      fireEvent.click(screen.getByText(messages.commandPalette.armVehicle));
    });

    const pending = useSkillConfirmStore.getState().pending;
    expect(pending?.policy.typedPhrase).toBe("ARM");
    expect(arm).not.toHaveBeenCalled();

    // Declining the dialog leaves the vehicle disarmed.
    await act(async () => useSkillConfirmStore.getState().resolvePending(false));
    expect(arm).not.toHaveBeenCalled();
  });

  it("Return to Home All asks first and recalls only on confirm", async () => {
    openPalette();
    act(() => {
      fireEvent.click(screen.getByText(messages.commandPalette.returnToHomeAll));
    });

    expect(screen.getByText("Return to Home — All Drones")).toBeTruthy();
    expect(returnFleetToLaunch).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "RTH All" }));
    });
    expect(returnFleetToLaunch).toHaveBeenCalledTimes(1);
  });
});
