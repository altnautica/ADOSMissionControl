/**
 * @license GPL-3.0-only
 *
 * Each EKF source set card is titled with its own number.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map([["EK3_SRC1_POSXY", 3], ["EK3_SRC2_POSXY", 0], ["EK3_SRC3_POSXY", 0]]),
    loading: false, error: null, dirtyParams: new Set(), hasRamWrites: false, loadProgress: null,
    hasLoaded: true, missingOptional: new Set(), refresh: vi.fn(), setLocalValue: vi.fn(),
    saveAllToRam: vi.fn(), commitToFlash: vi.fn(), revertAll: vi.fn(),
  }),
}));

import { ArduPilotNonGpsPanel } from "../ArduPilotNonGpsPanel";

describe("ArduPilotNonGpsPanel", () => {
  it("numbers the source set cards", () => {
    render(<ArduPilotNonGpsPanel />, { wrapper: IntlWrapper });
    for (const n of [1, 2, 3]) expect(screen.getByText(`Source set ${n}`)).toBeTruthy();
    expect(screen.queryByText("Source Set {n}")).toBeNull();
  });
});
