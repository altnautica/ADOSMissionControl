/**
 * Demo-fleet firmware coverage: each MockProtocol firmware variant reports the
 * vehicle class that drives the vehicle-gated FC config panels, and the demo
 * fleet exercises every variant.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { MockProtocol, type MockFirmware } from "@/mock/mock-protocol";
import { INavMockProtocol } from "@/mock/inav-mock-protocol";
import { DEMO_DRONES } from "@/mock/drones";

const EXPECTED: Record<MockFirmware, { firmwareType: string; vehicleClass: string }> = {
  "ardupilot-copter": { firmwareType: "ardupilot-copter", vehicleClass: "copter" },
  "ardupilot-heli": { firmwareType: "ardupilot-copter", vehicleClass: "copter" },
  "ardupilot-plane": { firmwareType: "ardupilot-plane", vehicleClass: "plane" },
  "ardupilot-sub": { firmwareType: "ardupilot-sub", vehicleClass: "sub" },
  "px4": { firmwareType: "px4", vehicleClass: "copter" },
  "px4-vtol": { firmwareType: "px4", vehicleClass: "vtol" },
  "betaflight": { firmwareType: "betaflight", vehicleClass: "copter" },
  "inav-plane": { firmwareType: "inav", vehicleClass: "plane" },
  // ArduPilot VTOLs run ArduPlane firmware → vehicleClass "plane".
  "ardupilot-plane-vtol": { firmwareType: "ardupilot-plane", vehicleClass: "plane" },
  "ardupilot-plane-tailsitter": { firmwareType: "ardupilot-plane", vehicleClass: "plane" },
  "ardupilot-plane-tiltrotor": { firmwareType: "ardupilot-plane", vehicleClass: "plane" },
  "ardupilot-rover": { firmwareType: "ardupilot-rover", vehicleClass: "rover" },
  "ardupilot-boat": { firmwareType: "ardupilot-rover", vehicleClass: "rover" },
};

describe("demo-fleet firmware variants", () => {
  it.each(Object.entries(EXPECTED))("%s reports the right firmware + vehicle class", (fw, expected) => {
    const info = new MockProtocol(fw as MockFirmware).getVehicleInfo();
    expect(info.firmwareType).toBe(expected.firmwareType);
    expect(info.vehicleClass).toBe(expected.vehicleClass);
  });

  it("px4-vtol reports the vtol capabilities that gate the VTOL panel", () => {
    const caps = new MockProtocol("px4-vtol").getCapabilities();
    expect(caps.supportsPx4Tuning).toBe(true);
  });

  it("inav-plane reports the iNav capabilities that gate the iNav-only panels", () => {
    const caps = new MockProtocol("inav-plane").getCapabilities();
    expect(caps.supportsLogicConditions).toBe(true);
    expect(caps.supportsFwApproach).toBe(true);
  });

  it("ardupilot-heli reports MAV_TYPE HELICOPTER (4) that gates the heli panel", async () => {
    const proto = new MockProtocol("ardupilot-heli");
    expect(proto.getVehicleInfo().vehicleType).toBe(4);
    // Heli frame class drives the heli panel's frame check.
    const frameClass = await proto.getParameter("FRAME_CLASS");
    expect(frameClass.value).toBe(6);
  });

  it("the ArduPlane VTOL variants load their Q_* params (VtolPanel populated)", async () => {
    const qp = new MockProtocol("ardupilot-plane-vtol");
    expect(qp.getVehicleInfo().vehicleType).toBe(22);
    expect((await qp.getParameter("Q_ENABLE")).value).toBe(1);
    expect((await qp.getParameter("Q_FRAME_CLASS")).value).toBe(1);

    const ts = new MockProtocol("ardupilot-plane-tailsitter");
    expect(ts.getVehicleInfo().vehicleType).toBe(23);
    expect((await ts.getParameter("Q_TAILSIT_ENABLE")).value).toBe(1);

    const tr = new MockProtocol("ardupilot-plane-tiltrotor");
    expect(tr.getVehicleInfo().vehicleType).toBe(21);
    expect((await tr.getParameter("Q_TILT_ENABLE")).value).toBe(1);
  });

  it("the ArduRover rover + boat report the rover class, frame + sail params", async () => {
    const rover = new MockProtocol("ardupilot-rover");
    expect(rover.getVehicleInfo().vehicleType).toBe(10);
    expect((await rover.getParameter("FRAME_CLASS")).value).toBe(1);

    const boat = new MockProtocol("ardupilot-boat");
    expect(boat.getVehicleInfo().vehicleType).toBe(11);
    expect((await boat.getParameter("FRAME_CLASS")).value).toBe(2);
    expect((await boat.getParameter("SAIL_ENABLE")).value).toBe(1);
  });

  it("PX4 resolves canonical names to its own params, as the real adapter does", async () => {
    // Panels read canonical names; PX4's FENCE_ENABLE is GF_ACTION. Without
    // the mapping the demo Geofence card read an absent param and showed 0.
    const px4 = new MockProtocol("px4");
    const read = await px4.getParameter("FENCE_ENABLE");
    expect(read.value).toBe(1);
    expect(read.name).toBe("FENCE_ENABLE");

    await px4.setParameter("FENCE_ENABLE", 3);
    expect((await px4.getParameter("GF_ACTION")).value).toBe(3);
  });

  it("the iNav mock round-trips name-based MSP settings (demo Configurator)", async () => {
    const proto = new INavMockProtocol({ vehicleClass: "plane" });
    expect(proto.getVehicleInfo().firmwareType).toBe("inav");
    await proto.settings.setSetting("motor_count", 2);
    const after = await proto.settings.getSetting("motor_count");
    expect(Number(after.value)).toBe(2);
  });

  it("the demo fleet covers every non-default firmware variant", () => {
    const firmwares = new Set(DEMO_DRONES.map((d) => d.firmware).filter(Boolean));
    for (const fw of ["px4", "px4-vtol", "ardupilot-plane", "ardupilot-plane-vtol", "ardupilot-plane-tailsitter", "ardupilot-plane-tiltrotor", "ardupilot-rover", "ardupilot-boat", "ardupilot-sub", "betaflight", "inav-plane", "ardupilot-heli"]) {
      expect(firmwares.has(fw as MockFirmware)).toBe(true);
    }
  });
});
