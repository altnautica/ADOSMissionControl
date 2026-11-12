/**
 * @license GPL-3.0-only
 *
 * The Betaflight failsafe procedure and switch mode read as named choices,
 * not as bare numbers the operator has to decode.
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";

vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map([["BF_FS_PROCEDURE", 2], ["BF_FS_SWITCH_MODE", 1], ["BF_FS_DELAY", 4]]),
    loading: false, error: null, dirtyParams: new Set(), hasRamWrites: false,
    loadProgress: null, hasLoaded: true, missingOptional: new Set(),
    refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash: vi.fn(), revertAll: vi.fn(),
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
});
