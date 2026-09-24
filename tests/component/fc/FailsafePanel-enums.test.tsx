/**
 * The Failsafe panel writes RCx_OPTION, battery-failsafe and fence-action
 * numbers straight to the flight controller, so what each select shows must be
 * what the firmware will do with that number. These tests render the panel
 * with no param metadata loaded (the offline floor) and pin that:
 * - an RC switch set to 31 reads as Motor Emergency Stop, not a blank select;
 * - the same battery action number reads per vehicle (Copter 1 = Land,
 *   Plane 1 = RTL, PX4 COM_LOW_BAT_ACT has its own enum);
 * - a value the table does not know shows its raw number;
 * - each vehicle loads only its own failsafe params.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";
import { PX4_PARAM_MAP } from "@/lib/protocol/firmware/px4-params";

const h = vi.hoisted(() => ({
  firmwareType: "ardupilot-copter" as string,
  vehicleClass: "copter" as string,
  params: new Map<string, number>(),
  paramNames: [] as string[],
}));

vi.mock("@/stores/drone-manager", async (importOriginal) => {
  const handler = {
    get firmwareType() { return h.firmwareType; },
    get vehicleClass() { return h.vehicleClass; },
    mapParameterName: (n: string) => (h.firmwareType === "px4" ? PX4_PARAM_MAP[n] ?? n : n),
  };
  const vehicleInfo = () => ({ firmwareType: h.firmwareType, vehicleClass: h.vehicleClass });
  const protocol = {
    isConnected: true,
    getCapabilities: () => ({}),
    getFirmwareHandler: () => handler,
    getVehicleInfo: vehicleInfo,
    setParameter: vi.fn(),
  };
  return {
    ...(await importOriginal<typeof import("@/stores/drone-manager")>()),
    useDroneManager: (sel: (s: unknown) => unknown) =>
      sel({
        drones: new Map([["d1", { protocol, vehicleInfo: vehicleInfo() }]]),
        selectedDroneId: "d1",
      }),
  };
});

// No metadata loaded: every select resolves from the offline fallback tables.
vi.mock("@/hooks/use-param-metadata", () => {
  const empty = new Map();
  return { useParamMetadataMap: () => empty };
});

vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: (opts: { paramNames: string[] }) => {
    h.paramNames = opts.paramNames;
    return {
      params: h.params,
      loading: false,
      error: null,
      dirtyParams: new Set<string>(),
      hasRamWrites: false,
      loadProgress: 1,
      hasLoaded: true,
      missingOptional: new Set<string>(),
      refresh: vi.fn(),
      setLocalValue: vi.fn(),
      saveAllToRam: vi.fn(),
      commitToFlash: vi.fn(),
    };
  },
}));

vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));

import { FailsafePanel } from "@/components/fc/safety/FailsafePanel";

function renderAs(firmwareType: string, vehicleClass: string, params: Record<string, number>) {
  h.firmwareType = firmwareType;
  h.vehicleClass = vehicleClass;
  h.params = new Map(Object.entries(params));
  return renderWithIntl(<FailsafePanel />).container.textContent ?? "";
}

beforeEach(() => cleanup());

describe("FailsafePanel enum selects", () => {
  it("shows an RC switch set to 31 as Motor Emergency Stop", () => {
    const text = renderAs("ardupilot-copter", "copter", { RC7_OPTION: 31, RC8_OPTION: 33 });
    expect(text).toContain("31: Motor Emergency Stop");
    expect(text).toContain("33: BRAKE Mode");
  });

  it("shows an unknown RC option as its raw number rather than a blank select", () => {
    const text = renderAs("ardupilot-copter", "copter", { RC7_OPTION: 9999 });
    expect(text).toContain("9999 (custom)");
  });

  it("reads battery failsafe action 1 as Land on Copter and RTL on Plane", () => {
    expect(renderAs("ardupilot-copter", "copter", { BATT_FS_LOW_ACT: 1 })).toContain("1: Land");
    cleanup();
    const plane = renderAs("ardupilot-plane", "plane", { BATT_FS_LOW_ACT: 1 });
    expect(plane).toContain("1: RTL");
    expect(plane).not.toContain("1: Land");
  });

  it("gives PX4 its own COM_LOW_BAT_ACT control", () => {
    const text = renderAs("px4", "copter", { BATT_FS_LOW_ACT: 3 });
    expect(text).toContain("COM_LOW_BAT_ACT");
    expect(text).toContain("3: Return at critical level, land at emergency level");
    expect(h.paramNames).not.toContain("RC1_OPTION");
  });

  it("uses the vehicle's FENCE_ACTION meaning", () => {
    expect(renderAs("ardupilot-copter", "copter", { FENCE_ACTION: 4 })).toContain("4: Brake or Land");
  });

  it("loads the Copter failsafe params on a Copter and the Plane ones on a Plane", () => {
    renderAs("ardupilot-copter", "copter", {});
    expect(h.paramNames).toEqual(expect.arrayContaining(["FS_THR_ENABLE", "FS_GCS_ENABLE", "FS_EKF_ACTION"]));
    expect(h.paramNames).not.toContain("FS_SHORT_ACTN");
    expect(h.paramNames).not.toContain("FS_GCS_ENABL");
    cleanup();
    renderAs("ardupilot-plane", "plane", {});
    expect(h.paramNames).toEqual(expect.arrayContaining(["FS_SHORT_ACTN", "FS_LONG_ACTN", "FS_GCS_ENABL", "THR_FAILSAFE"]));
    expect(h.paramNames).not.toContain("FS_THR_ENABLE");
  });
});
