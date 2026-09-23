/**
 * @license GPL-3.0-only
 *
 * The take-off altitude field is free text: a typed value is not bound by the
 * input's min/max. These tests pin that an out-of-range altitude never reaches
 * the take-off dispatch, and that the confirm dialog names the altitude that
 * will be commanded so a mistyped value is visible before confirming.
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import type * as Skills from "@/lib/skills";

const { toast, activateSpy } = vi.hoisted(() => ({
  toast: vi.fn(),
  activateSpy: vi.fn((..._args: unknown[]) => Promise.resolve()),
}));

vi.mock("@/lib/skills", async () => {
  const actual = await vi.importActual<typeof Skills>("@/lib/skills");
  return { ...actual, activate: activateSpy };
});
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ supports: () => true }),
}));
vi.mock("@/components/flight/FollowMeButton", () => ({ FollowMeButton: () => null }));
vi.mock("@/components/flight/LoadoutSelector", () => ({ LoadoutSelector: () => null }));
vi.mock("@/components/shared/flight-mode-selector", () => ({
  FlightModeSelector: () => null,
}));
vi.mock("@/components/flight/action-dialogs", () => ({ ChecklistModal: () => null }));

import { ActionsPanel } from "@/components/flight/ActionsPanel";
import { SkillConfirmHost } from "@/components/cockpit/SkillConfirmHost";
import { registerBuiltins } from "@/lib/skills";
import { buildSkillContextFor, useSkillRegistry } from "@/lib/skills/registry";
import type { ConfirmPolicy, SkillProtocol } from "@/lib/skills/types";
import { useDroneManager } from "@/stores/drone-manager";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";

function wrap(node: ReactNode): ReactNode {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      {node}
    </NextIntlClientProvider>
  );
}

function pressTakeoffWith(altitude: string) {
  render(wrap(<ActionsPanel />));
  fireEvent.change(screen.getByRole("spinbutton"), { target: { value: altitude } });
  fireEvent.keyDown(window, { key: "T", shiftKey: true });
}

describe("take-off altitude gating", () => {
  beforeEach(() => {
    toast.mockClear();
    activateSpy.mockClear();
    useDroneManager.setState({ selectedDroneId: "drone-1" });
  });
  afterEach(() => {
    cleanup();
    useDroneManager.setState({ selectedDroneId: null });
    useSkillConfirmStore.getState().resolvePending(false);
  });

  it.each(["1000", "1e3", "0.5", "-5", ""])(
    "refuses %j with an error toast and never dispatches",
    (altitude) => {
      pressTakeoffWith(altitude);
      expect(activateSpy).not.toHaveBeenCalled();
      expect(toast).toHaveBeenCalledWith(
        "Takeoff altitude must be between 1 and 120 m",
        "error",
      );
    },
  );

  it("dispatches an in-range altitude", () => {
    pressTakeoffWith("100");
    expect(toast).not.toHaveBeenCalled();
    expect(activateSpy).toHaveBeenCalledTimes(1);
    expect(activateSpy.mock.calls[0][0]).toBe("takeoff");
    expect(activateSpy.mock.calls[0][2]).toEqual({ altitudeM: 100 });
  });

  it("names the requested altitude in the confirm dialog", async () => {
    const actual = await vi.importActual<typeof Skills>("@/lib/skills");
    registerBuiltins();
    expect(useSkillRegistry.getState().skills.has("takeoff")).toBe(true);
    const confirm = vi.fn((policy: ConfirmPolicy) =>
      useSkillConfirmStore.getState().request(policy),
    );
    const ctx = {
      ...buildSkillContextFor("drone-1"),
      protocol: {} as SkillProtocol,
      armState: "disarmed" as const,
      confirm,
    };
    render(wrap(<SkillConfirmHost />));
    let pending: Promise<void> | undefined;
    act(() => {
      pending = actual.activate("takeoff", ctx, { altitudeM: 100 });
    });
    expect(confirm.mock.calls[0][0].values).toEqual({ altitude: 100 });
    expect(screen.getByText(/Take off to 100 m/)).toBeTruthy();
    act(() => useSkillConfirmStore.getState().resolvePending(false));
    await pending;
  });
});
