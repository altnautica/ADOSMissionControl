/**
 * @license GPL-3.0-only
 *
 * The Betaflight failsafe procedure and switch mode read as named choices,
 * not as bare numbers the operator has to decode.
 */

import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

const setLocalValue = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map([["BF_FS_PROCEDURE", 2], ["BF_FS_SWITCH_MODE", 1], ["BF_FS_DELAY", 4]]),
    loading: false, error: null, dirtyParams: new Set(), hasRamWrites: false,
    loadProgress: null, hasLoaded: true, missingOptional: new Set(),
    refresh: vi.fn(), setLocalValue, saveAllToRam: vi.fn(), commitToFlash: vi.fn(), revertAll: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: "betaflight", vehicleClass: "copter" }),
}));

import { BfFailsafePanel } from "../BfFailsafePanel";

describe("BfFailsafePanel", () => {
  it("shows the procedure and switch mode by name", () => {
    renderWithIntl(<BfFailsafePanel />);
    const choices = screen.getAllByRole("combobox").map((c) => c.textContent ?? "");
    expect(choices.some((text) => text.includes("GPS rescue"))).toBe(true);
    expect(choices.some((text) => text.includes("Kill"))).toBe(true);
    expect(screen.queryByDisplayValue("2")).toBeNull();
  });

  // Betaflight failsafe.h: FAILSAFE_PROCEDURE_AUTO_LANDING = 0, DROP_IT = 1, GPS_RESCUE = 2.
  it.each([["Land", 0], ["Drop", 1], ["GPS rescue", 2]])("writes %s as %i", (label, code) => {
    setLocalValue.mockClear();
    renderWithIntl(<BfFailsafePanel />);
    const procedure = screen.getAllByRole("combobox").find((c) => (c.textContent ?? "").includes("GPS rescue"))!;
    fireEvent.click(procedure);
    fireEvent.click(screen.getByRole("option", { name: `${code}: ${label}` }));
    expect(setLocalValue).toHaveBeenCalledWith("BF_FS_PROCEDURE", code);
  });
});
