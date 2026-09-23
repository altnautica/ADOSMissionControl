/**
 * @module fc/shared/param-fields-unknown.test
 * @description Param-form panels must not present a parameter they have not
 * read as 0. The "feature disabled" note needs the gate param's real value,
 * and the stream-rate panel edits whichever of the MAVn_* / SRn_* families the
 * vehicle reports.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { HarmonicNotchPanel } from "../../notch/HarmonicNotchPanel";
import { StreamRatesPanel } from "../../streams/StreamRatesPanel";

let params = new Map<string, number>();
let hasLoaded = true;

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ options, value }: { options: { value: string; label: string }[]; value: string }) => (
    <div data-testid="select">{options.find((o) => o.value === value)?.label ?? ""}</div>
  ),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-flash-commit-toast", () => ({ useFlashCommitToast: () => ({ showFlashResult: vi.fn() }) }));
vi.mock("@/hooks/use-panel-scroll", () => ({ usePanelScroll: () => null }));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));
vi.mock("@/hooks/use-param-metadata", () => ({ useParamMetadataMap: () => new Map() }));
vi.mock("@/hooks/use-firmware-capabilities", () => ({ useFirmwareCapabilities: () => ({ vehicleClass: "copter" }) }));
vi.mock("@/hooks/use-param-label", () => ({ useParamLabel: () => ({ paramName: (c: string) => c }) }));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params, loading: false, error: null, dirtyParams: new Set<string>(), hasRamWrites: false,
    loadProgress: null, hasLoaded, missingOptional: new Set<string>(),
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
vi.mock("../PanelHeader", () => ({ PanelHeader: () => null }));
vi.mock("../../parameters/ParamFieldLabel", () => ({
  ParamFieldLabel: ({ param }: { param: string }) => <span data-testid="param">{param}</span>,
}));

beforeEach(() => {
  params = new Map();
  hasLoaded = true;
});

describe("ParamFieldsPanel with unread params", () => {
  it("does not claim the notch is disabled before INS_HNTCH_ENABLE is read", () => {
    hasLoaded = false;
    render(<HarmonicNotchPanel />);
    expect(screen.queryByText(/harmonic notch is disabled/)).toBeNull();
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });

  it("states the notch is disabled only when the vehicle reports 0", () => {
    params = new Map([["INS_HNTCH_ENABLE", 0]]);
    render(<HarmonicNotchPanel />);
    expect(screen.getByText(/harmonic notch is disabled/)).toBeTruthy();
  });
});

describe("StreamRatesPanel parameter family", () => {
  it("edits SR0_* on a vehicle that reports the older family", () => {
    params = new Map([["SR0_RAW_SENS", 2], ["SR0_EXTRA1", 4]]);
    render(<StreamRatesPanel />);
    const names = screen.getAllByTestId("param").map((el) => el.textContent);
    expect(names).toContain("SR0_RAW_SENS");
    expect(names.some((n) => n?.startsWith("MAV"))).toBe(false);
    // Groups the vehicle did not report are absent, not 0 Hz.
    expect(screen.getAllByText("not present").length).toBe(8);
  });

  it("edits MAV1_* on a vehicle that reports the newer family", () => {
    params = new Map([["MAV1_RAW_SENS", 2]]);
    render(<StreamRatesPanel />);
    expect(screen.getAllByTestId("param").map((el) => el.textContent)).toContain("MAV1_RAW_SENS");
  });

  it("shows no rates when the vehicle reported neither family", () => {
    render(<StreamRatesPanel />);
    expect(screen.queryAllByTestId("param")).toHaveLength(0);
    expect(screen.getByText(/reports no stream-rate parameters/)).toBeTruthy();
  });
});
