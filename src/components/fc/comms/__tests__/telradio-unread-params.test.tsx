/**
 * @license GPL-3.0-only
 *
 * Radio Config shows only parameters the vehicle reported: an unread SERIAL or
 * SYSID parameter is "not present" rather than a stand-in default, and PX4
 * (which has neither family) gets no serial or system-ID cards at all.
 */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let params = new Map<string, number>();
let firmwareType = "ardupilot-copter";

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-flash-commit-toast", () => ({ useFlashCommitToast: () => ({ showFlashResult: vi.fn() }) }));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));
vi.mock("@/hooks/use-param-metadata", () => ({ useParamMetadataMap: () => new Map() }));
vi.mock("@/hooks/use-param-label", () => ({ useParamLabel: () => ({ label: (c: string) => c }) }));
vi.mock("@/hooks/use-firmware-capabilities", () => ({ useFirmwareCapabilities: () => ({ firmwareType }) }));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params, loading: false, error: null, dirtyParams: new Set<string>(),
    hasRamWrites: false, loadProgress: null, hasLoaded: true,
    refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash: vi.fn(),
  }),
}));
const droneState = { drones: new Map([["d1", { protocol: {} }]]), selectedDroneId: "d1" };
vi.mock("@/stores/drone-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/stores/drone-manager")>()),
  useDroneManager: (selector: (s: unknown) => unknown) => selector(droneState),
}));
vi.mock("@/components/indicators/ArmedWarningBanner", () => ({
  ArmedWarningBanner: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../shared/PanelHeader", () => ({ PanelHeader: () => null }));
vi.mock("../../shared/ParamEnumSelect", () => ({
  ParamEnumSelect: ({ value }: { value: number }) => <div data-testid="enum">{value}</div>,
  useParamEnums: () => ({ enumValues: () => [] }),
}));
vi.mock("../../parameters/ParamFieldLabel", () => ({ ParamFieldLabel: ({ raw }: { raw: string }) => <span>{raw}</span> }));

import { TelRadioPanel } from "../TelRadioPanel";

beforeEach(() => {
  params = new Map();
  firmwareType = "ardupilot-copter";
});
afterEach(cleanup);

describe("TelRadioPanel parameters", () => {
  it("shows unread SERIAL and SYSID parameters as not present", () => {
    params = new Map([["SERIAL1_PROTOCOL", 2]]);
    render(<TelRadioPanel />);
    expect(screen.getAllByTestId("enum").map((e) => e.textContent)).toEqual(["2"]);
    expect(screen.getAllByText("not present")).toHaveLength(5);
    expect(screen.queryByDisplayValue("255")).toBeNull();
  });

  it("shows no serial or system-ID configuration on PX4", () => {
    firmwareType = "px4";
    render(<TelRadioPanel />);
    expect(screen.queryByText("Serial Port Configuration")).toBeNull();
    expect(screen.queryByText("System Identification")).toBeNull();
  });
});
