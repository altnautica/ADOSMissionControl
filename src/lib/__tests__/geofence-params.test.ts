/**
 * @license GPL-3.0-only
 *
 * The fence floor reaches the flight controller: ArduPilot gets FENCE_ALT_MIN
 * and the FENCE_TYPE floor bit and reports it back; PX4, which has no floor,
 * refuses a non-zero one instead of dropping it.
 */

import { describe, expect, it, vi } from "vitest";

import { readFenceParams, writeFenceParams } from "../geofence-elements";
import type { DroneProtocol } from "@/lib/protocol/types";

function protocol(params: Record<string, number> = {}) {
  const setParameter = vi.fn().mockResolvedValue({ success: true, message: "" });
  const getParameter = vi.fn(async (name: string) => ({ name, value: params[name], type: 9, index: 0, count: 1 }));
  const p: DroneProtocol = { setParameter, getParameter } as never;
  return { p, setParameter };
}

const snap = { enabled: true, maxAltitude: 60, minAltitude: 10, breachAction: "RTL" as const };

describe("fence altitude floor", () => {
  it("writes FENCE_ALT_MIN and the floor bit on ArduPilot", async () => {
    const { p, setParameter } = protocol();
    expect((await writeFenceParams(p, false, snap)).success).toBe(true);
    expect(setParameter).toHaveBeenCalledWith("FENCE_TYPE", 4 | 1 | 8);
    expect(setParameter).toHaveBeenCalledWith("FENCE_ALT_MIN", 10);
  });

  it("refuses a floor on PX4 without writing anything", async () => {
    const { p, setParameter } = protocol();
    const r = await writeFenceParams(p, true, snap);
    expect(r.success).toBe(false);
    expect(setParameter).not.toHaveBeenCalled();
  });

  it("reads the floor back only when its FENCE_TYPE bit is set", async () => {
    const base = { FENCE_ENABLE: 1, FENCE_ALT_MAX: 60, FENCE_ACTION: 1, FENCE_ALT_MIN: 12 };
    const on = await readFenceParams(protocol({ ...base, FENCE_TYPE: 13 }).p, false);
    const off = await readFenceParams(protocol({ ...base, FENCE_TYPE: 5 }).p, false);
    expect(on.minAltitude).toBe(12);
    expect(off.minAltitude).toBe(0);
  });
});
