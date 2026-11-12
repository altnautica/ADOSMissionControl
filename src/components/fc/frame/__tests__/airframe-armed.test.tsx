/**
 * @license GPL-3.0-only
 *
 * PX4 airframe selection (SYS_AUTOSTART) is locked while the vehicle may be
 * armed: tiles, custom id and Save are disabled.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

const setLocalValue = vi.fn();
const lock = { isHardBlocked: true };
vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: lock.isHardBlocked, isHardBlocked: lock.isHardBlocked, lockMessage: "", hardBlockMessage: lock.isHardBlocked ? "Disarm first" : "" }),
}));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map([["SYS_AUTOSTART", 4001], ["SYS_AUTOCONFIG", 0]]),
    loading: false, error: null, dirtyParams: new Set(["SYS_AUTOSTART"]), hasRamWrites: true,
    loadProgress: null, hasLoaded: true,
    refresh: vi.fn(), setLocalValue, saveAllToRam: vi.fn(), commitToFlash: vi.fn(),
  }),
}));
vi.mock("@/components/indicators/ArmedWarningBanner", () => ({ ArmedWarningBanner: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { AirframePanel } from "../AirframePanel";

describe("AirframePanel armed guard", () => {
  it("disables selection, Save and Flash while hard-blocked", () => {
    render(<AirframePanel />, { wrapper: IntlWrapper });
    const tile = screen.getAllByText(/^ID: /)[0].closest("button") as HTMLButtonElement;
    expect(tile.disabled).toBe(true);
    fireEvent.click(tile);
    expect(setLocalValue).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Save to/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Write to Flash/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Disarm first")).toBeTruthy();
  });
});
