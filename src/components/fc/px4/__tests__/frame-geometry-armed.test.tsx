/**
 * @license GPL-3.0-only
 *
 * Frame and actuator geometry (CA_*, VT_TYPE, Q_ENABLE/Q_FRAME_*, H_SW_TYPE)
 * cannot be edited while the vehicle may be armed; other tuning stays
 * editable. A parameter the board does not have reads "not present", never 0.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { DroneProtocol } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";

const state = { params: new Map<string, number>(), dirty: new Set<string>() };
vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({ isArmed: true, isHardBlocked: true, lockMessage: "", hardBlockMessage: "Disarm first" }),
}));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: state.params, loading: false, error: null, dirtyParams: state.dirty, hasRamWrites: false,
    loadProgress: null, hasLoaded: true, missingOptional: new Set(),
    refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash: vi.fn(), revertAll: vi.fn(),
  }),
}));

import { Px4VtolPanel } from "../Px4VtolPanel";
import { Px4ControlAllocationPanel } from "../Px4ControlAllocationPanel";
import { VtolPanel } from "../../vtol/VtolPanel";
import { ArduPilotHeliPanel } from "../../frame/ArduPilotHeliPanel";
import { isFrameGeometryParam } from "../../shared/frame-geometry-params";

function inputFor(param: string): HTMLInputElement {
  const label = screen.getAllByText(param)[0];
  const row = label.closest("div.grid") as HTMLElement;
  return row.querySelector("input, select, button") as HTMLInputElement;
}

describe("frame geometry while armed", () => {
  it("PX4 VTOL: VT_TYPE locked, durations editable, absent params marked", () => {
    state.params = new Map([["VT_TYPE", 2], ["VT_F_TRANS_DUR", 5]]);
    render(<Px4VtolPanel />, { wrapper: IntlWrapper });
    expect(inputFor("VT_TYPE").disabled).toBe(true);
    expect(inputFor("VT_F_TRANS_DUR").disabled).toBe(false);
    expect(screen.getAllByText("not present on this board").length).toBeGreaterThan(0);
  });

  it("PX4 control allocation: rotor count locked", () => {
    state.params = new Map([["CA_AIRFRAME", 0], ["CA_ROTOR_COUNT", 4]]);
    render(<Px4ControlAllocationPanel />, { wrapper: IntlWrapper });
    expect(inputFor("CA_ROTOR_COUNT").disabled).toBe(true);
    expect(inputFor("CA_AIRFRAME").disabled).toBe(true);
  });

  it("ArduPlane VTOL: Q_ENABLE locked, transition time editable", () => {
    state.params = new Map([["Q_ENABLE", 1], ["Q_TRANSITION_MS", 5000]]);
    render(<VtolPanel />, { wrapper: IntlWrapper });
    expect(inputFor("Q_ENABLE").disabled).toBe(true);
    expect(inputFor("Q_TRANSITION_MS").disabled).toBe(false);
  });

  it("classifies the heli swashplate type and frame params as geometry", () => {
    for (const p of ["H_SW_TYPE", "FRAME_CLASS", "Q_FRAME_TYPE", "Q_TILT_MASK", "Q_TAILSIT_ENABLE", "CA_R0_PX"]) {
      expect(isFrameGeometryParam(p), p).toBe(true);
    }
    for (const p of ["H_COL_MIN", "Q_TRANSITION_MS", "VT_F_TRANS_DUR", "Q_TAILSIT_ANGLE"]) {
      expect(isFrameGeometryParam(p), p).toBe(false);
    }
  });

  it("Save stays disabled while a geometry edit is staged, enabled for other edits", () => {
    const protocol = { isConnected: true, getFirmwareHandler: () => null } as Partial<DroneProtocol> as DroneProtocol;
    useDroneManager.setState({
      drones: new Map([["d1", { id: "d1", name: "d1", protocol } as Partial<ManagedDrone> as ManagedDrone]]),
      selectedDroneId: "d1",
    });
    // Every CA_* parameter is geometry, so that panel has no "other" edit.
    const cases: [() => React.ReactElement, string, string | null][] = [
      [() => <Px4VtolPanel />, "VT_TYPE", "VT_F_TRANS_DUR"],
      [() => <Px4ControlAllocationPanel />, "CA_ROTOR_COUNT", null],
      [() => <VtolPanel />, "Q_ENABLE", "Q_TRANSITION_MS"],
      [() => <ArduPilotHeliPanel />, "H_SW_TYPE", "H_COL_MIN"],
    ];
    const saveButton = () => screen.getByRole("button", { name: /save to flight controller/i }) as HTMLButtonElement;
    for (const [panel, geometry, other] of cases) {
      state.params = new Map([[geometry, 1], ...(other ? [[other, 1] as [string, number]] : [])]);
      state.dirty = new Set(other ? [geometry, other] : [geometry]);
      render(panel(), { wrapper: IntlWrapper });
      expect(saveButton().disabled, geometry).toBe(true);
      cleanup();
      if (!other) continue;
      state.dirty = new Set([other]);
      render(panel(), { wrapper: IntlWrapper });
      expect(saveButton().disabled, other).toBe(false);
      cleanup();
    }
    state.dirty = new Set();
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  });
});
