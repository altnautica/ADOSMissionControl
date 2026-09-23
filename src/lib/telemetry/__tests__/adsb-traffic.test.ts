/**
 * @module telemetry/adsb-traffic.test
 * @description The per-contact ADS-B stream becomes one traffic list, and a
 * contact that stops reporting leaves the list instead of staying frozen at
 * its last position.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdsbTrafficTable } from "../adsb-traffic";
import { TELEMETRY_STALE_MS } from "../freshness";
import type { AdsbContact } from "@/lib/protocol/types";
import type { INavAdsbVehicle } from "@/lib/protocol/msp/msp-decoders-inav";

function contact(icao: number, over: Partial<AdsbContact> = {}): AdsbContact {
  return {
    timestamp: Date.now(), icao, lat: 12.97, lon: 77.59, altitudeM: 1524,
    altitudeGeometric: true, emitterType: 1, tslc: 0, ...over,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("ADS-B traffic table", () => {
  it("keys contacts by ICAO and publishes the whole list in list units", () => {
    let list: INavAdsbVehicle[] = [];
    const table = createAdsbTrafficTable((v) => { list = v; });
    table.update(contact(1));
    table.update(contact(2, { altitudeM: undefined }));
    table.update(contact(1, { lat: 13 }));
    expect(list.map((v) => v.icao)).toEqual([1, 2]);
    expect(list[0].lat).toBe(13);
    expect(list[0].alt).toBe(152400); // cm
    expect(Number.isNaN(list[1].alt)).toBe(true); // not reported, not sea level
    table.dispose();
  });

  it("drops a contact that stops reporting, down to an empty list", () => {
    let list: INavAdsbVehicle[] = [];
    const table = createAdsbTrafficTable((v) => { list = v; });
    table.update(contact(1));
    vi.advanceTimersByTime(TELEMETRY_STALE_MS - 1000);
    table.update(contact(2));
    vi.advanceTimersByTime(2000);
    expect(list.map((v) => v.icao)).toEqual([2]);
    vi.advanceTimersByTime(TELEMETRY_STALE_MS);
    expect(list).toEqual([]);
    table.dispose();
  });
});
