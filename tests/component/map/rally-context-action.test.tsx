/**
 * The map's "Add Rally Point" asks the operator for the loiter altitude,
 * defaulting to the vehicle's return altitude (never its current altitude,
 * which is 0 on the ground), reports what the FC answered to the upload, and
 * is offered only when the connected FC accepts a rally upload.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

import {
  handleAddRallyConfirmed,
  readReturnAltitude,
} from "@/components/map/context-menu/actions/markers";
import { RallyAltitudePanel } from "@/components/map/context-menu/panels/RallyAltitudePanel";
import { useMenuItems, type MenuContext } from "@/components/map/context-menu/use-menu-items";
import type { DroneProtocol } from "@/lib/protocol/types";

afterEach(cleanup);

function protocolWith(firmwareType: string, params: Record<string, number>): DroneProtocol {
  return {
    getVehicleInfo: () => ({ firmwareType }),
    getParameter: async (name: string) => {
      if (!(name in params)) throw new Error(`no ${name}`);
      return { name, value: params[name], type: 9, index: 0, count: 1 };
    },
  } as unknown as DroneProtocol;
}

describe("rally altitude default", () => {
  it("reads the firmware's return altitude in metres", async () => {
    expect(await readReturnAltitude(protocolWith("ardupilot-copter", { RTL_ALT: 1500 }))).toBe(15);
    expect(await readReturnAltitude(protocolWith("ardupilot-plane", { ALT_HOLD_RTL: 10000 }))).toBe(100);
    expect(await readReturnAltitude(protocolWith("px4", { RTL_RETURN_ALT: 60 }))).toBe(60);
  });

  it("offers no default when the return altitude means 'current' or cannot be read", async () => {
    expect(await readReturnAltitude(protocolWith("ardupilot-copter", { RTL_ALT: 0 }))).toBeNull();
    expect(await readReturnAltitude(protocolWith("ardupilot-copter", {}))).toBeNull();
    expect(await readReturnAltitude(null)).toBeNull();
  });

  it("cannot confirm without an altitude", () => {
    const onConfirm = vi.fn();
    render(<RallyAltitudePanel alt="" setAlt={() => {}} onConfirm={onConfirm} onCancel={() => {}} />);
    const add = screen.getByRole("button", { name: /Add/ });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(add);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe("rally add and upload", () => {
  const menuPos = { lat: 12.97, lon: 77.59, x: 0, y: 0 };

  it("adds the point at the confirmed altitude and reports a rejected upload", async () => {
    const addRally = vi.fn();
    const report = vi.fn();
    await handleAddRallyConfirmed({
      menuPos,
      alt: 40,
      addRally,
      uploadRally: async () => ({ success: false, message: "Not supported" }),
      report,
    });
    expect(addRally).toHaveBeenCalledWith(expect.objectContaining({ lat: 12.97, lon: 77.59, alt: 40 }));
    expect(report).toHaveBeenCalledWith("Rally upload failed: Not supported", "error");
  });

  it("reports a successful upload", async () => {
    const report = vi.fn();
    await handleAddRallyConfirmed({
      menuPos,
      alt: 40,
      addRally: vi.fn(),
      uploadRally: async () => ({ success: true, message: "ok" }),
      report,
    });
    expect(report).toHaveBeenCalledWith(expect.stringContaining("uploaded"), "success");
  });
});

describe("rally menu item", () => {
  const ctx: MenuContext = {
    isConnected: true,
    isArmed: false,
    canNavigate: false,
    isCopter: true,
    flightMode: "LOITER",
    canRally: false,
  };

  it("is hidden when the FC cannot take a rally upload", () => {
    const { result } = renderHook(() => useMenuItems(ctx));
    expect(result.current.some((i) => i.id === "add-rally")).toBe(false);
  });

  it("is offered when it can", () => {
    const { result } = renderHook(() => useMenuItems({ ...ctx, canRally: true }));
    expect(result.current.some((i) => i.id === "add-rally")).toBe(true);
  });
});
