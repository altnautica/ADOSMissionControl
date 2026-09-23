/**
 * @module fc/safety/fence-and-battery-fields.test
 * @description The safety and power panels must show what the parameter on
 * the vehicle means on that firmware. ArduPilot FENCE_ENABLE is a 0/1 switch
 * with the fence types in the FENCE_TYPE bitmask; PX4's canonical
 * FENCE_ENABLE is GF_ACTION (a breach action), so no enable toggle may touch
 * it; PX4's battery source and thresholds are BAT1_SOURCE and remaining-charge
 * fractions, not ArduPilot monitor types and volts.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { PX4_PARAM_MAP } from "@/lib/protocol/firmware/px4-params";

let firmwareType: "ardupilot-copter" | "px4" = "ardupilot-copter";
let params = new Map<string, number>();
const setLocalValue = vi.fn();

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
vi.mock("@/hooks/use-firmware-capabilities", () => ({ useFirmwareCapabilities: () => ({ firmwareType }) }));
vi.mock("@/hooks/use-param-label", () => {
  const paramName = (c: string) => (firmwareType === "px4" ? PX4_PARAM_MAP[c] ?? c : c);
  return {
    useParamLabel: () => ({
      paramName,
      label: (raw: string) => {
        const [name, ...rest] = raw.split(" — ");
        return [paramName(name), ...rest].join(" — ");
      },
      firmwareType,
    }),
  };
});

function panelState() {
  return {
    params, loading: false, error: null, dirtyParams: new Set<string>(), hasRamWrites: false,
    loadProgress: null, hasLoaded: true, missingOptional: [],
    refresh: vi.fn(), setLocalValue, saveAllToRam: vi.fn(), commitToFlash: vi.fn(),
    getProtocol: () => ({}), scrollRef: null,
  };
}
vi.mock("@/hooks/use-panel-params", () => ({ usePanelParams: () => panelState() }));
vi.mock("@/hooks/use-fc-panel-state", () => ({ useFcPanelState: () => panelState() }));
vi.mock("@/hooks/use-param-panel-actions", () => ({
  useParamPanelActions: () => ({ saving: false, save: vi.fn(), flash: vi.fn() }),
}));

const droneState = {
  getSelectedProtocol: () => ({}),
  getSelectedDrone: () => ({ vehicleInfo: { vehicleClass: "copter" } }),
};
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (selector: (s: unknown) => unknown) => selector(droneState),
}));
const fenceStore = {
  zones: [], addZone: vi.fn(), removeZone: vi.fn(), toggleZoneRole: vi.fn(),
  uploadFence: vi.fn(), downloadFence: vi.fn(), uploadState: "idle", downloadState: "idle",
  breachStatus: 0, breachCount: 0, breachType: 0,
};
vi.mock("@/stores/geofence-store", () => ({
  useGeofenceStore: (selector: (s: unknown) => unknown) => selector(fenceStore),
}));
vi.mock("@/components/indicators/ArmedWarningBanner", () => ({
  ArmedWarningBanner: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../shared/PanelHeader", () => ({ PanelHeader: () => null }));
vi.mock("../../parameters/ParamStar", () => ({
  StarredParam: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../parameters/ParamFieldLabel", () => ({
  ParamFieldLabel: ({ raw }: { raw: string }) => <span>{raw}</span>,
}));
vi.mock("../../power/LiveBatteryDisplay", () => ({ LiveBatteryDisplay: () => null }));

import { FailsafePanel } from "../FailsafePanel";
import { GeofencePanel } from "../GeofencePanel";
import { PowerPanel } from "../../power/PowerPanel";

beforeEach(() => {
  setLocalValue.mockClear();
  firmwareType = "ardupilot-copter";
  params = new Map();
});

describe("ArduPilot fence controls", () => {
  it("shows FENCE_ENABLE as on/off and every FENCE_TYPE bit, and edits only the bit clicked", () => {
    params = new Map([["FENCE_ENABLE", 1], ["FENCE_TYPE", 7]]);
    render(<FailsafePanel />);

    expect(screen.getByRole("switch", { name: "FENCE_ENABLE" }).getAttribute("aria-checked")).toBe("true");
    for (const name of ["Max Altitude", "Circle", "Polygon"]) {
      expect(screen.getByRole("button", { name }).getAttribute("aria-pressed")).toBe("true");
    }
    expect(screen.getByRole("button", { name: "Min Altitude" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText(/Altitude Only/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Circle" }));
    expect(setLocalValue).toHaveBeenCalledWith("FENCE_TYPE", 5);
    expect(setLocalValue).not.toHaveBeenCalledWith("FENCE_ENABLE", expect.anything());
  });
});

describe("PX4 geofence", () => {
  it("offers no enable toggle that would rewrite the GF_ACTION breach action", () => {
    firmwareType = "px4";
    params = new Map([["FENCE_ENABLE", 3]]);
    render(<GeofencePanel />);

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText(/set in the Failsafe panel/)).toBeTruthy();
    expect(setLocalValue).not.toHaveBeenCalled();
  });
});

describe("PX4 power panel", () => {
  it("reads BAT1_SOURCE with PX4's values and the thresholds as fractions", () => {
    firmwareType = "px4";
    params = new Map([
      ["BATT_MONITOR", 0], ["BATT_CAPACITY", 5000], ["BAT1_N_CELLS", 4], ["BAT1_R_INTERNAL", -1],
      ["BATT_FS_LOW_VOLT", 0.15], ["BATT_FS_CRT_VOLT", 0.07], ["BAT_EMERGEN_THR", 0.05], ["BATT_FS_LOW_ACT", 2],
    ]);
    render(<PowerPanel />);

    const selects = screen.getAllByTestId("select").map((el) => el.textContent);
    expect(selects).toContain("0: Power Module");
    expect(selects).not.toContain("0 — Disabled");
    expect(selects).toContain("2: Land mode");
    expect(screen.getByText("BAT_LOW_THR — Low Threshold")).toBeTruthy();
    expect(screen.queryByText(/Low Voltage/)).toBeNull();
    expect(screen.queryByText(/Critical Voltage/)).toBeNull();
    expect(screen.getByText(/not volts/)).toBeTruthy();
  });
});
