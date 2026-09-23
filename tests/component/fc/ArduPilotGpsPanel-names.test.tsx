/**
 * ArduPilot 4.6 renamed the per-receiver GPS params (`GPS_TYPE` -> `GPS1_TYPE`,
 * `GPS_RATE_MS` -> `GPS1_RATE_MS`, ...). The GPS panel must show the value the
 * vehicle reported under whichever name it uses, write back to that same
 * name, and never show a made-up default when neither spelling exists.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { renderWithIntl } from "../../helpers/intl-wrapper";

const h = vi.hoisted(() => ({
  params: new Map<string, number>(),
  requested: [] as string[],
  setLocalValue: vi.fn(),
}));

vi.mock("@/stores/drone-manager", () => {
  const handler = { firmwareType: "ardupilot-copter", mapParameterName: (n: string) => n };
  const protocol = { isConnected: true, getFirmwareHandler: () => handler };
  return {
    useDroneManager: (sel: (s: unknown) => unknown) =>
      sel({ getSelectedProtocol: () => protocol, getSelectedDrone: () => ({ protocol }) }),
  };
});
vi.mock("@/hooks/use-param-metadata", () => {
  const empty = new Map();
  return { useParamMetadataMap: () => empty };
});
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: (opts: { paramNames: readonly string[]; optionalParams?: readonly string[] }) => {
    h.requested = [...opts.paramNames, ...(opts.optionalParams ?? [])];
    return {
      params: h.params,
      loading: false,
      error: null,
      dirtyParams: new Set<string>(),
      hasRamWrites: false,
      loadProgress: null,
      hasLoaded: true,
      missingOptional: new Set<string>(),
      refresh: vi.fn(),
      setLocalValue: h.setLocalValue,
      saveAllToRam: vi.fn(),
      commitToFlash: vi.fn(),
    };
  },
}));
vi.mock("@/hooks/use-unsaved-guard", () => ({ useUnsavedGuard: () => {} }));
vi.mock("@/hooks/use-panel-scroll", () => ({ usePanelScroll: () => ({ current: null }) }));

import { ArduPilotGpsPanel } from "@/components/fc/sensors/ArduPilotGpsPanel";

const GLOBALS = { GPS_AUTO_SWITCH: 1, GPS_SBAS_MODE: 2, GPS_MIN_ELEV: -100, GPS_AUTO_CONFIG: 1 };

function renderWith(params: Record<string, number>) {
  h.params = new Map(Object.entries({ ...GLOBALS, ...params }));
  return renderWithIntl(<ArduPilotGpsPanel />).container.textContent ?? "";
}

beforeEach(() => {
  cleanup();
  h.setLocalValue.mockReset();
});

describe("ArduPilotGpsPanel param names", () => {
  it("reads the 4.6+ per-receiver names", () => {
    const text = renderWith({ GPS1_TYPE: 9, GPS1_RATE_MS: 100 });
    expect(h.requested).toEqual(expect.arrayContaining(["GPS1_TYPE", "GPS1_RATE_MS", "GPS1_GNSS_MODE", "GPS1_POS_X"]));
    expect(text).toContain("9 — DroneCAN");
    expect(text).toContain("100 ms — 10 Hz");
    expect(text).not.toContain("1 — Auto");
  });

  it("still reads the pre-4.6 names", () => {
    const text = renderWith({ GPS_TYPE: 2, GPS_RATE_MS: 200 });
    expect(text).toContain("2 — uBlox");
    expect(text).toContain("200 ms — 5 Hz");
  });

  it("says the field is absent instead of showing a default", () => {
    const text = renderWith({});
    expect(text).toContain("GPS 1 type is not on this firmware");
    expect(text).toContain("GPS update rate is not on this firmware");
    expect(text).not.toContain("1 — Auto");
  });

  it("writes antenna offsets back under the vehicle's own name", () => {
    renderWith({ GPS1_TYPE: 1, GPS1_POS_X: 0.1, GPS1_POS_Y: 0, GPS1_POS_Z: 0 });
    fireEvent.change(screen.getByDisplayValue("0.1"), { target: { value: "0.25" } });
    expect(h.setLocalValue).toHaveBeenCalledWith("GPS1_POS_X", 0.25);
  });
});
