import { describe, expect, it } from "vitest";
import { liveTraffic } from "../TrafficPill";
import type { INavAdsbVehicle } from "@/lib/protocol/msp/msp-decoders-inav";

const T0 = 1_000_000;

function contact(icao: number, ttlSec: number): INavAdsbVehicle {
  return {
    callsign: `C${icao}`,
    icao,
    lat: 12.9,
    lon: 77.6,
    alt: 30_000,
    heading: 90,
    lastSeenMs: 0,
    emitterType: 1,
    ttlSec,
  };
}

describe("liveTraffic", () => {
  it("hides the whole list once it stops arriving", () => {
    expect(liveTraffic([contact(1, 60)], T0, T0 + 30_000)).toEqual([]);
  });

  it("counts each TTL down from the list's arrival and drops expired contacts", () => {
    const live = liveTraffic([contact(1, 2), contact(2, 10)], T0, T0 + 3_000);
    expect(live.map((v) => [v.icao, v.ttlSec])).toEqual([[2, 7]]);
  });

  it("shows nothing before any list has arrived", () => {
    expect(liveTraffic([contact(1, 10)], 0, T0)).toEqual([]);
  });
});
