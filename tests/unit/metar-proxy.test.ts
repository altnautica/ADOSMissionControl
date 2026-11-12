// @vitest-environment node
/**
 * The METAR service sends no CORS header, so the browser reads it through the
 * same-origin `/api/metar` route, and a failing lookup logs one line, not one
 * per arm.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("idb-keyval", () => ({ get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) }));
vi.mock("@/lib/environment/nearest-airport", () => ({
  findNearestMetarStation: vi.fn(async () => ({
    airport: { icao: "VOBL", name: "Bengaluru", countryCode: "IN" },
    distanceKm: 12,
  })),
}));

import { GET } from "@/app/api/metar/route";
import { getWeatherSnapshot, resetWeatherFailureLogForTest } from "@/lib/environment/weather-provider";

let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  resetWeatherFailureLogForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("weather snapshot fetch", () => {
  it("asks the same-origin route, never the METAR host", async () => {
    fetchMock.mockResolvedValue(new Response("[]", { status: 200 }));
    await getWeatherSnapshot(13, 77.6, Date.now());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/metar?ids=VOBL");
  });

  it("logs a failing lookup once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await getWeatherSnapshot(13, 77.6, Date.now())).toBeUndefined();
    expect(await getWeatherSnapshot(13, 77.6, Date.now())).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("/api/metar route", () => {
  it("fetches the station from the METAR service and returns its JSON", async () => {
    fetchMock.mockResolvedValue(new Response('[{"icaoId":"VOBL"}]', { status: 200 }));
    const res = await GET(new NextRequest("http://localhost/api/metar?ids=vobl"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ icaoId: "VOBL" }]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://aviationweather.gov/api/data/metar?ids=VOBL&format=json&hours=2",
    );
  });

  it("answers an empty upstream body with an empty list", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const res = await GET(new NextRequest("http://localhost/api/metar?ids=VOBL"));
    expect(await res.json()).toEqual([]);
  });

  it("refuses anything but one station id", async () => {
    const res = await GET(new NextRequest("http://localhost/api/metar?ids=VOBL,KJFK"));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an upstream failure as 502", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const res = await GET(new NextRequest("http://localhost/api/metar?ids=VOBL"));
    expect(res.status).toBe(502);
  });
});
