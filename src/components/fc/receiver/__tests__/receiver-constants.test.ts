/**
 * @module fc/receiver/receiver-constants.test
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { RC_REVERSAL, RSSI_TYPE_OPTIONS, receiverParams } from "../receiver-constants";

describe("receiver params per firmware", () => {
  it("reads PX4 reversal from RCn_REV with -1 meaning reversed", () => {
    const names = receiverParams(true);
    expect(names).toContain("RC3_REV");
    expect(names.some((n) => n.endsWith("_REVERSED"))).toBe(false);
    expect(RC_REVERSAL.px4.isReversed(-1)).toBe(true);
    expect(RC_REVERSAL.px4.isReversed(1)).toBe(false);
    expect(RC_REVERSAL.px4.encode(true)).toBe(-1);
    expect(RC_REVERSAL.px4.encode(false)).toBe(1);
  });

  it("does not read ArduPilot-only params on PX4", () => {
    const names = receiverParams(true);
    expect(names).not.toContain("RC_PROTOCOLS");
    expect(names).not.toContain("RSSI_TYPE");
    expect(names.some((n) => n.endsWith("_DZ"))).toBe(false);
  });

  it("keeps ArduPilot's RCn_REVERSED 0/1 encoding", () => {
    const names = receiverParams(false);
    expect(names).toEqual(expect.arrayContaining(["RC_PROTOCOLS", "RSSI_TYPE", "RC3_REVERSED", "RC3_DZ"]));
    expect(RC_REVERSAL.ardupilot.isReversed(1)).toBe(true);
    expect(RC_REVERSAL.ardupilot.encode(true)).toBe(1);
    expect(RC_REVERSAL.ardupilot.encode(false)).toBe(0);
  });
});

describe("RSSI_TYPE options", () => {
  it("labels each value as ArduPilot's RssiType enum defines it", () => {
    const label = (v: string) => RSSI_TYPE_OPTIONS.find((o) => o.value === v)?.label;
    expect(label("3")).toMatch(/Receiver Protocol.*CRSF\/ELRS/);
    expect(label("4")).toMatch(/PWM Input Pin/);
    expect(label("5")).toMatch(/Telemetry Radio RSSI/);
  });
});
