/**
 * @module fc/sub/sub-config-names.test
 * @description The Sub panel edits whichever position-controller names the
 * vehicle reports, and shows a gain it did not read as unknown, never 0.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { SubConfigPanel } from "../SubConfigPanel";

let params = new Map<string, number>();

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-flash-commit-toast", () => ({ useFlashCommitToast: () => ({ showFlashResult: vi.fn() }) }));
vi.mock("@/hooks/use-panel-scroll", () => ({ usePanelScroll: () => null }));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));
vi.mock("@/hooks/use-param-metadata", () => ({ useParamMetadataMap: () => new Map() }));
vi.mock("@/hooks/use-param-label", () => ({ useParamLabel: () => ({ paramName: (c: string) => c }) }));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params, loading: false, error: null, dirtyParams: new Set<string>(), hasRamWrites: false,
    loadProgress: null, hasLoaded: true, missingOptional: new Set<string>(),
    refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash: vi.fn(), revertAll: vi.fn(),
  }),
}));
const droneState = { getSelectedProtocol: () => ({}) };
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (selector: (s: unknown) => unknown) => selector(droneState),
}));
vi.mock("@/components/indicators/ArmedWarningBanner", () => ({
  ArmedWarningBanner: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../shared/PanelHeader", () => ({ PanelHeader: () => null }));
vi.mock("../../parameters/ParamFieldLabel", () => ({
  ParamFieldLabel: ({ param }: { param: string }) => <span data-testid="param">{param}</span>,
}));

beforeEach(() => {
  params = new Map();
});

describe("SubConfigPanel position-controller names", () => {
  it("edits the renamed PSC_D_*/PSC_NE_* gains a current vehicle reports", () => {
    params = new Map([["PSC_D_POS_P", 1.5], ["PSC_NE_VEL_P", 2.5]]);
    render(<SubConfigPanel />);
    const names = screen.getAllByTestId("param").map((el) => el.textContent);
    expect(names).toContain("PSC_D_POS_P");
    expect(names).toContain("PSC_NE_VEL_P");
    expect(screen.getByDisplayValue("1.5")).toBeTruthy();
  });

  it("edits the older PSC_POSZ_*/PSC_VELXY_* names where those are reported", () => {
    params = new Map([["PSC_POSZ_P", 3]]);
    render(<SubConfigPanel />);
    expect(screen.getAllByTestId("param").map((el) => el.textContent)).toContain("PSC_POSZ_P");
  });

  it("shows unread gains as unknown instead of 0", () => {
    render(<SubConfigPanel />);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    expect(screen.getAllByText("—").length).toBeGreaterThan(10);
  });
});
