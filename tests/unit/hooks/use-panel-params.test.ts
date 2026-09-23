/**
 * `optionalParams` names are read like any other panel param; they only differ
 * in that a failed read does not block the panel. A name listed only as
 * optional must still be requested from the flight controller, otherwise the
 * panel renders a fallback in place of the vehicle's real value.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { protocol } = vi.hoisted(() => ({
  protocol: {
    isConnected: true,
    getParameter: vi.fn(),
  },
}));

vi.mock("@/stores/drone-manager", () => {
  const state = { getSelectedProtocol: () => protocol, selectedDroneId: "d1" };
  const useDroneManager = (sel: (s: typeof state) => unknown) => sel(state);
  useDroneManager.getState = () => state;
  return { useDroneManager };
});
vi.mock("@/lib/param-cache-idb", () => ({
  cachePanelToIDB: () => Promise.resolve(),
  getCachedPanelFromIDB: () => Promise.resolve(null),
}));

import { usePanelParams } from "@/hooks/use-panel-params";

const REQUIRED = ["BARO_ALT_OFFSET"] as const;
const OPTIONAL = ["RNGFND1_TYPE", "RNGFND2_TYPE"] as const;

beforeEach(() => {
  vi.clearAllMocks();
  protocol.getParameter.mockImplementation(async (name: string) => {
    if (name === "RNGFND2_TYPE") {
      throw Object.assign(new Error("absent"), { code: "param_absent" });
    }
    return { value: name === "RNGFND1_TYPE" ? 20 : 0, type: 9, index: 0, count: 3 };
  });
});

describe("usePanelParams", () => {
  it("reads optional-only names and exposes their values", async () => {
    const { result } = renderHook(() =>
      usePanelParams({ paramNames: REQUIRED, optionalParams: OPTIONAL, panelId: "test-optional" }),
    );

    await act(async () => { await result.current.refresh(); });

    const requested = protocol.getParameter.mock.calls.map((c) => c[0]);
    expect(requested).toEqual(expect.arrayContaining(["BARO_ALT_OFFSET", "RNGFND1_TYPE", "RNGFND2_TYPE"]));
    await waitFor(() => expect(result.current.params.get("RNGFND1_TYPE")).toBe(20));
    // An absent optional is left out of the map, and does not block the panel.
    expect(result.current.params.has("RNGFND2_TYPE")).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasLoaded).toBe(true);
  });

  it("requests a name listed in both sets only once", async () => {
    const { result } = renderHook(() =>
      usePanelParams({ paramNames: REQUIRED, optionalParams: REQUIRED, panelId: "test-dedupe" }),
    );
    await act(async () => { await result.current.refresh(); });
    expect(protocol.getParameter).toHaveBeenCalledTimes(1);
  });
});
