import { describe, it, expect } from "vitest";
import { decodePayload, messageName, tickRates, type MsgRate } from "../mavlink-inspector-data";

function field(fields: { name: string; value: string }[] | null, name: string): string | undefined {
  return fields?.find((f) => f.name === name)?.value;
}

describe("inspector payload decoders use the MAVLink wire order", () => {
  it("HEARTBEAT: custom_mode first, then type/autopilot/base_mode", () => {
    const dv = new DataView(new ArrayBuffer(9));
    dv.setUint32(0, 5, true); // custom_mode
    dv.setUint8(4, 2); // type = quadrotor
    dv.setUint8(5, 3); // autopilot = ArduPilot
    dv.setUint8(6, 0x81); // base_mode
    dv.setUint8(7, 4); // system_status
    dv.setUint8(8, 3);
    const f = decodePayload(0, dv);
    expect(field(f, "custom_mode")).toBe("5");
    expect(field(f, "type")).toBe("2");
    expect(field(f, "autopilot")).toBe("3");
    expect(field(f, "base_mode")).toBe("0x81");
  });

  it("GPS_RAW_INT: lat/lon/alt at 8/12/16, fix and satellites at 28/29", () => {
    const dv = new DataView(new ArrayBuffer(30));
    dv.setInt32(8, 129_000_000, true);
    dv.setInt32(12, 775_000_000, true);
    dv.setInt32(16, 920_500, true);
    dv.setUint8(28, 3);
    dv.setUint8(29, 14);
    const f = decodePayload(24, dv);
    expect(field(f, "lat")).toBe("12.9000000°");
    expect(field(f, "lon")).toBe("77.5000000°");
    expect(field(f, "alt")).toBe("920.5m");
    expect(field(f, "fix_type")).toBe("3");
    expect(field(f, "satellites")).toBe("14");
  });

  it("SYS_STATUS: battery_remaining is the int8 at offset 30, not drop_rate_comm", () => {
    const dv = new DataView(new ArrayBuffer(31));
    dv.setUint16(18, 250, true); // drop_rate_comm
    dv.setInt8(30, 76);
    expect(field(decodePayload(1, dv), "battery_remaining")).toBe("76%");
  });

  it("names message 35, 136 and 137 per the MAVLink definitions", () => {
    expect(messageName(35)).toBe("RC_CHANNELS_RAW");
    expect(messageName(136)).toBe("TERRAIN_REPORT");
    expect(messageName(137)).toBe("SCALED_PRESSURE2");
  });
});

describe("tickRates", () => {
  it("measures each window and decays a stopped message to 0 Hz", () => {
    const rates = new Map<number, MsgRate>([[0, { count: 4, hz: 0 }]]);
    tickRates(rates, 1);
    expect(rates.get(0)?.hz).toBe(4);
    tickRates(rates, 1); // no frames in this window
    expect(rates.get(0)?.hz).toBe(0);
  });
});
