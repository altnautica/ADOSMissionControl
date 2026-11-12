/**
 * @license GPL-3.0-only
 *
 * Betaflight gets a failsafe panel (BF_FS_*) and PX4 a failure-detector and
 * return panel (FD_* / RTL_*), each reachable from the Setup nav.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../tests/helpers/intl-wrapper";
import { FC_NAV_ITEMS } from "../fc-nav-items";

const requested: string[][] = [];
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: ({ paramNames }: { paramNames: string[] }) => {
    requested.push(paramNames);
    return {
      params: new Map(paramNames.map((n) => [n, 1])), loading: false, error: null, dirtyParams: new Set(),
      hasRamWrites: false, loadProgress: null, hasLoaded: true, missingOptional: new Set(),
      refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash: vi.fn(), revertAll: vi.fn(),
    };
  },
}));

import { BfFailsafePanel } from "@/components/fc/betaflight/BfFailsafePanel";
import { Px4SafetyPanel } from "@/components/fc/px4/Px4SafetyPanel";

describe("safety setup panels", () => {
  it("Betaflight failsafe reads the BF_FS_* parameters", () => {
    render(<BfFailsafePanel />, { wrapper: IntlWrapper });
    expect(screen.getByText("Stage 2 failsafe")).toBeTruthy();
    expect(requested.at(-1)).toContain("BF_FS_PROCEDURE");
  });

  it("PX4 safety reads the failure detector and RTL parameters", () => {
    render(<Px4SafetyPanel />, { wrapper: IntlWrapper });
    expect(screen.getByText("Failure detector")).toBeTruthy();
    expect(requested.at(-1)).toEqual(expect.arrayContaining(["FD_FAIL_P", "RTL_RETURN_ALT", "RTL_CONE_ANG"]));
    expect(requested.at(-1)!.some((n) => n.startsWith("CBRK_"))).toBe(false);
  });

  it("both are in the Safety section of the nav", () => {
    for (const id of ["bf-failsafe", "px4-safety"]) {
      expect(FC_NAV_ITEMS.find((i) => i.id === id)?.section).toBe("Safety");
    }
  });
});
