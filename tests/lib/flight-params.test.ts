import { describe, expect, it } from "vitest";
import type { DroneProtocol } from "@/lib/protocol/types";
import { readVehicleFlightParams } from "@/lib/mission/flight-params";
import { ARDUPLANE_MOCK_PARAMS, MOCK_PARAMS, type MockParam } from "@/mock/mock-params";
import { PX4_MOCK_PARAMS } from "@/mock/mock-params-px4";

/** A protocol answering from a parameter list (later entries win), throwing for unknown names. */
function protocolFrom(firmwareType: string, params: MockParam[]): DroneProtocol {
  const byName = new Map(params.map((p) => [p.name, p.value]));
  return {
    getVehicleInfo: () => ({ firmwareType }),
    getParameter: async (name: string) => {
      const value = byName.get(name);
      if (value === undefined) throw new Error(`no parameter ${name}`);
      return { name, value, type: 9, index: 0, count: 1 };
    },
  } as unknown as DroneProtocol;
}

describe("readVehicleFlightParams", () => {
  it("reads ArduCopter's vertical speeds under the old cm/s names when the new ones are absent", async () => {
    const params = await readVehicleFlightParams(protocolFrom("ardupilot-copter", MOCK_PARAMS), "copter");
    expect(params.climbRateMps).toBeCloseTo(2.5, 6);
    expect(params.descentRateMps).toBeCloseTo(1.5, 6);
    expect(params.landSpeedMps).toBeCloseTo(0.5, 6);
    expect(params.landSlowAltM).toBeCloseTo(10, 6);
    expect(params.rtlLoiterS).toBeCloseTo(5, 6);
    expect(params.rallyLimitKm).toBeCloseTo(0.3, 6);
    expect(params.rallyIncludeHome).toBe(true);
    expect(params.fenceMarginM).toBe(2);
  });

  it("prefers the metre-per-second name", async () => {
    const params = await readVehicleFlightParams(
      protocolFrom("ardupilot-copter", [...MOCK_PARAMS, { name: "WP_SPD_UP", value: 4, type: 9 }]),
      "copter",
    );
    expect(params.climbRateMps).toBe(4);
  });

  it("reads ArduPlane's TECS rates and rally rules", async () => {
    const params = await readVehicleFlightParams(protocolFrom("ardupilot-plane", ARDUPLANE_MOCK_PARAMS), "plane");
    expect(params.climbRateMps).toBe(5);
    expect(params.descentRateMps).toBe(5);
    expect(params.rallyLimitKm).toBe(5);
    expect(params.rallyIncludeHome).toBe(false);
  });

  it("reads PX4's multicopter rates and RTL type", async () => {
    const params = await readVehicleFlightParams(protocolFrom("px4", PX4_MOCK_PARAMS), "copter");
    expect(params.climbRateMps).toBe(3);
    expect(params.descentRateMps).toBe(1);
    expect(params.landSpeedMps).toBeCloseTo(0.7, 6);
    expect(params.px4RtlType).toBe(0);
  });
});
