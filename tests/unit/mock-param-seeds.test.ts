import { describe, expect, it } from "vitest";
import { MOCK_PARAMS, ARDUPLANE_MOCK_PARAMS, QUADPLANE_MOCK_PARAMS, TAILSITTER_MOCK_PARAMS, TILTROTOR_MOCK_PARAMS, ROVER_MOCK_PARAMS, BOAT_MOCK_PARAMS } from "@/mock/mock-params";
import { PX4_MOCK_PARAMS, PX4_VTOL_MOCK_PARAMS } from "@/mock/mock-params-px4";
import { MockProtocol } from "@/mock/mock-protocol";

const names = (set: { name: string }[]) => new Set(set.map((p) => p.name));
const last = (set: { name: string; value: number }[], name: string) => [...set].reverse().find((p) => p.name === name)?.value;

describe("demo parameter seeds", () => {
  it("keeps the quadplane group off copters and plain planes", () => {
    expect(names(MOCK_PARAMS).has("Q_ENABLE")).toBe(false);
    expect(names(ARDUPLANE_MOCK_PARAMS).has("Q_ENABLE")).toBe(false);
    for (const set of [QUADPLANE_MOCK_PARAMS, TAILSITTER_MOCK_PARAMS, TILTROTOR_MOCK_PARAMS]) {
      expect(last(set, "Q_ENABLE")).toBe(1);
      expect(names(set).has("Q_TRANS_DECEL")).toBe(true);
    }
  });

  it("seeds the reversed flag for every rover and boat output it maps", () => {
    for (const set of [ROVER_MOCK_PARAMS, BOAT_MOCK_PARAMS]) {
      const n = names(set);
      expect(n.has("SERVO1_REVERSED")).toBe(true);
      expect(n.has("SERVO3_REVERSED")).toBe(true);
    }
  });

  it("gives the PX4 VTOL its transition group and the multicopter none", () => {
    expect(names(PX4_VTOL_MOCK_PARAMS).has("VT_TYPE")).toBe(true);
    expect([...names(PX4_MOCK_PARAMS)].some((n) => n.startsWith("VT_"))).toBe(false);
  });

  it("answers the receiver config reads on the Betaflight demo vehicle", async () => {
    const bf = new MockProtocol("betaflight") as MockProtocol & { getRxConfig?: () => Promise<{ serialrxProvider: number; midrc: number }>; getRxMap?: () => Promise<number[]> };
    const cfg = await bf.getRxConfig!();
    expect(cfg.midrc).toBe(1500);
    expect((await bf.getRxMap!()).length).toBe(8);
    const ap = new MockProtocol("ardupilot-copter") as MockProtocol & { getRxConfig?: unknown };
    expect(ap.getRxConfig).toBeUndefined();
  });
});
