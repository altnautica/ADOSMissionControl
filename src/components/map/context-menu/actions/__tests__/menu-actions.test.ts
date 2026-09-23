/**
 * The flight-affecting map context-menu actions against a recording protocol
 * stub: exact command arguments, ordering, and that every non-success result
 * reaches the menu report.
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getElevation = vi.fn<(lat: number, lon: number, signal?: AbortSignal) => Promise<number | null>>();
vi.mock("@/lib/terrain/terrain-provider", () => ({
  getElevation: (lat: number, lon: number, signal?: AbortSignal) => getElevation(lat, lon, signal),
}));

import { handlePointCamera } from "../camera";
import { handleSetEkfOrigin, handleSetHomeConfirmed } from "../home";
import { handleSetHeading } from "../markers";
import { handleOrbitConfirmed } from "../orbit";
import type { CommandResult, DroneProtocol } from "@/lib/protocol/types";

const OK: CommandResult = { success: true, resultCode: 0, message: "" };
const DENIED: CommandResult = { success: false, resultCode: 2, message: "denied" };

const menuPos = { x: 10, y: 10, lat: 47.001, lon: 8.001 };

function recorder() {
  const calls: Array<[string, unknown[]]> = [];
  const rec =
    (name: string, result: CommandResult = OK) =>
    (...args: unknown[]) => {
      calls.push([name, args]);
      return Promise.resolve(result);
    };
  return { calls, rec };
}

describe("map context-menu actions", () => {
  const report = vi.fn();
  beforeEach(() => {
    report.mockClear();
    getElevation.mockReset();
  });

  describe("Point Camera Here", () => {
    it("sends the clicked point's AMSL ground elevation in the global frame", async () => {
      getElevation.mockResolvedValue(912.5);
      const { calls, rec } = recorder();
      const protocol = { setRoiLocation: rec("setRoiLocation") } as Partial<DroneProtocol> as DroneProtocol;
      await handlePointCamera({ protocol, menuPos, report });
      expect(calls).toEqual([["setRoiLocation", [menuPos.lat, menuPos.lon, 912.5]]]);
      expect(report).toHaveBeenLastCalledWith("Camera pointed at the selected point", "success");
    });

    it("refuses without an elevation instead of sending a home-relative altitude", async () => {
      getElevation.mockResolvedValue(null);
      const { calls, rec } = recorder();
      const protocol = { setRoiLocation: rec("setRoiLocation") } as Partial<DroneProtocol> as DroneProtocol;
      await handlePointCamera({ protocol, menuPos, report });
      expect(calls).toEqual([]);
      expect(report).toHaveBeenLastCalledWith(expect.stringContaining("Camera not pointed"), "error");
    });

    it("reports a refused ROI", async () => {
      getElevation.mockResolvedValue(10);
      const { rec } = recorder();
      const protocol = { setRoiLocation: rec("setRoiLocation", DENIED) } as Partial<DroneProtocol> as DroneProtocol;
      await handlePointCamera({ protocol, menuPos, report });
      expect(report).toHaveBeenLastCalledWith("Point camera failed: denied", "error");
    });
  });

  describe("Set Home / Set EKF Origin", () => {
    it("bounds the terrain lookup and reports the wait before the command", async () => {
      getElevation.mockResolvedValue(900);
      const { calls, rec } = recorder();
      const protocol = { setHome: rec("setHome") } as Partial<DroneProtocol> as DroneProtocol;
      await handleSetHomeConfirmed({ protocol, menuPos, report });
      expect(getElevation.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
      expect(report.mock.calls[0]).toEqual(["Resolving elevation…", "info"]);
      expect(calls).toEqual([["setHome", [false, menuPos.lat, menuPos.lon, 900]]]);
    });

    it("refuses Set Home when the elevation lookup fails or times out", async () => {
      getElevation.mockResolvedValue(null);
      const { calls, rec } = recorder();
      const protocol = { setHome: rec("setHome") } as Partial<DroneProtocol> as DroneProtocol;
      await handleSetHomeConfirmed({ protocol, menuPos, report });
      expect(calls).toEqual([]);
      expect(report).toHaveBeenLastCalledWith(expect.stringContaining("Home not set"), "error");
    });

    it("refuses Set EKF Origin without an elevation and reports a rejection", async () => {
      getElevation.mockResolvedValueOnce(null);
      const { calls, rec } = recorder();
      const protocol = { setEkfOrigin: rec("setEkfOrigin", { ...DENIED, message: "rejected" }) } as Partial<DroneProtocol> as DroneProtocol;
      await handleSetEkfOrigin({ protocol, menuPos, report });
      expect(calls).toEqual([]);
      getElevation.mockResolvedValueOnce(450);
      await handleSetEkfOrigin({ protocol, menuPos, report });
      expect(calls).toEqual([["setEkfOrigin", [menuPos.lat, menuPos.lon, 450]]]);
      expect(report).toHaveBeenLastCalledWith("rejected", "error");
    });
  });

  describe("Set Heading Toward", () => {
    it("asks for an absolute heading with the shortest turn and reports the result", async () => {
      const { calls, rec } = recorder();
      const protocol = { setYaw: rec("setYaw") } as Partial<DroneProtocol> as DroneProtocol;
      // Target due east of the vehicle.
      await handleSetHeading({ protocol, menuPos: { ...menuPos, lat: 47, lon: 8.01 }, fromLat: 47, fromLon: 8, report });
      expect(calls).toHaveLength(1);
      const [heading, rate, direction, relative] = calls[0][1] as [number, number, number, boolean];
      expect(Math.round(heading)).toBe(90);
      expect(rate).toBe(30);
      expect(direction).toBe(0);
      expect(relative).toBe(false);
      expect(report).toHaveBeenLastCalledWith("Turning to heading 90°", "success");
    });

    it("reports a refused yaw", async () => {
      const { rec } = recorder();
      const protocol = { setYaw: rec("setYaw", DENIED) } as Partial<DroneProtocol> as DroneProtocol;
      await handleSetHeading({ protocol, menuPos, fromLat: 47, fromLon: 8, report });
      expect(report).toHaveBeenLastCalledWith("Set heading failed: denied", "error");
    });
  });

  describe("Orbit Here", () => {
    it("faces the centre (yaw behaviour 0) and signs the radius by direction", async () => {
      const { calls, rec } = recorder();
      const protocol = { orbit: rec("orbit") } as Partial<DroneProtocol> as DroneProtocol;
      await handleOrbitConfirmed({ protocol, menuPos, radius: 40, clockwise: false, relativeAlt: 25, report });
      expect(calls).toEqual([["orbit", [-40, 2, 0, menuPos.lat, menuPos.lon, 25]]]);
    });

    it("reports a refused orbit", async () => {
      const { rec } = recorder();
      const protocol = { orbit: rec("orbit", DENIED) } as Partial<DroneProtocol> as DroneProtocol;
      await handleOrbitConfirmed({ protocol, menuPos, radius: 40, clockwise: true, relativeAlt: 25, report });
      expect(report).toHaveBeenLastCalledWith("Orbit failed: denied", "error");
    });
  });
});
