import { describe, it, expect } from "vitest";
import {
  latLonToUTM,
  utmToLatLon,
  latLonToMGRS,
  mgrsLatBand,
  utmZone,
  formatLatLon,
} from "@/lib/coordinates/coordinate-format";

describe("latLonToUTM()", () => {
  it("matches an authoritative reference value (51.2 N, 7.5 E -> zone 32U)", () => {
    // Documented reference: from_latlon(51.2, 7.5) =
    //   (395201.31, 5673135.24, zone 32, band 'U')
    const utm = latLonToUTM(51.2, 7.5);
    expect(utm.zone).toBe(32);
    expect(utm.hemisphere).toBe("N");
    expect(utm.easting).toBeCloseTo(395201.31, 1);
    expect(utm.northing).toBeCloseTo(5673135.24, 1);
  });

  it("applies the 500000 false easting and southern 10000000 false northing", () => {
    const north = latLonToUTM(1, 3); // zone 31, near central meridian
    expect(north.easting).toBeGreaterThan(490000);
    expect(north.easting).toBeLessThan(510000);
    const south = latLonToUTM(-1, 3);
    expect(south.hemisphere).toBe("S");
    // Southern northing measured down from 10,000,000 m.
    expect(south.northing).toBeGreaterThan(9800000);
    expect(south.northing).toBeLessThan(10000000);
  });
});

describe("latLonToUTM() <-> utmToLatLon() round-trip", () => {
  const points: Array<[number, number]> = [
    [34.0, -118.0], // Los Angeles
    [51.2, 7.5], // reference point
    [-33.8688, 151.2093], // Sydney (southern hemisphere)
    [0, 0.0001], // near the equator + prime meridian
    [60.0, 5.0], // Norway exception zone
  ];

  for (const [lat, lon] of points) {
    it(`round-trips ${lat}, ${lon} within ~1 m`, () => {
      const utm = latLonToUTM(lat, lon);
      const back = utmToLatLon(utm);
      // 1 metre of latitude ~ 9e-6 deg; longitude at this scale is tighter.
      expect(back.lat).toBeCloseTo(lat, 5);
      expect(back.lon).toBeCloseTo(lon, 5);
    });
  }

  it("known coordinate 34.0, -118.0 round-trips UTM within 1 m", () => {
    const utm = latLonToUTM(34.0, -118.0);
    expect(utm.zone).toBe(11);
    const back = utmToLatLon(utm);
    // Convert the degree error to metres (~111320 m per degree of latitude).
    expect(Math.abs(back.lat - 34.0) * 111320).toBeLessThan(1);
    expect(Math.abs(back.lon - -118.0) * 111320 * Math.cos(34 * Math.PI / 180)).toBeLessThan(1);
  });
});

describe("utmZone()", () => {
  it("computes the standard zone", () => {
    expect(utmZone(34, -118)).toBe(11);
    expect(utmZone(51.2, 7.5)).toBe(32);
    expect(utmZone(0, -180)).toBe(1);
    expect(utmZone(0, 179.9)).toBe(60);
    // +180 is the zone 60 edge, never a non-existent zone 61.
    expect(utmZone(0, 180)).toBe(60);
  });

  it("applies the Norway and Svalbard exceptions", () => {
    expect(utmZone(60, 5)).toBe(32); // Norway widened zone 32
    expect(utmZone(75, 5)).toBe(31); // Svalbard
    expect(utmZone(75, 15)).toBe(33);
    expect(utmZone(75, 25)).toBe(35);
    expect(utmZone(75, 38)).toBe(37);
  });
});

describe("mgrsLatBand()", () => {
  it("returns the correct 8-degree band letter (skipping I and O)", () => {
    expect(mgrsLatBand(34)).toBe("S");
    expect(mgrsLatBand(51.2)).toBe("U");
    expect(mgrsLatBand(0)).toBe("N"); // 0..8 band
    expect(mgrsLatBand(-0.0001)).toBe("M"); // just south of the equator
    expect(mgrsLatBand(-80)).toBe("C"); // southern edge
    expect(mgrsLatBand(83.9)).toBe("X"); // northern edge (X is 12 deg wide)
  });

  it("has no band in the polar caps outside [-80, 84)", () => {
    expect(mgrsLatBand(84)).toBeNull();
    expect(mgrsLatBand(-80.1)).toBeNull();
  });
});

describe("latLonToMGRS()", () => {
  it("matches a known MGRS string (51.2 N, 7.5 E)", () => {
    // Derived from the authoritative UTM value 32U 395201 5673135.
    expect(latLonToMGRS(51.2, 7.5, 5)).toBe("32ULB9520173135");
  });

  it("produces the expected grid-zone designator + 100km square for 34, -118", () => {
    const s = latLonToMGRS(34.0, -118.0, 5);
    expect(s).toMatch(/^11SMT\d{10}$/);
  });

  it("truncates digits with lower precision (fewer digits per axis)", () => {
    const full = latLonToMGRS(51.2, 7.5, 5) ?? ""; // "32ULB9520173135"
    expect(latLonToMGRS(51.2, 7.5, 3)).toBe("32ULB952731");
    expect(latLonToMGRS(51.2, 7.5, 1)).toBe("32ULB97");
    expect(latLonToMGRS(51.2, 7.5, 4)).toBe("32ULB95207313");
    // Higher-precision string carries the lower-precision one's leading digits.
    expect(full.startsWith("32ULB")).toBe(true);
  });

  it("clamps precision to the 1..5 range and defaults to 5", () => {
    expect(latLonToMGRS(51.2, 7.5)).toBe("32ULB9520173135");
    expect(latLonToMGRS(51.2, 7.5, 9)).toBe("32ULB9520173135");
    expect(latLonToMGRS(51.2, 7.5, 0)).toBe("32ULB97");
  });

  it("returns null in the polar caps instead of a wrong reference", () => {
    expect(latLonToMGRS(85, 10)).toBeNull();
    expect(latLonToMGRS(-85, 10)).toBeNull();
  });
});

describe("formatLatLon()", () => {
  it("formats decimal degrees round-trippable to 6 places", () => {
    expect(formatLatLon(34.0, -118.0, "dd")).toBe("34.000000, -118.000000");
    expect(formatLatLon(12.9716, 77.5946, "dd")).toBe("12.971600, 77.594600");
  });

  it("formats DMS with hemisphere letters", () => {
    expect(formatLatLon(34.0, -118.0, "dms")).toBe("34°00'00.00\" N, 118°00'00.00\" W");
    expect(formatLatLon(-33.5, 151.25, "dms")).toBe("33°30'00.00\" S, 151°15'00.00\" E");
  });

  it("computes minutes and seconds from the fractional degree", () => {
    // 12.582 deg -> 12 deg, 0.582*60 = 34.92' -> 34', 0.92*60 = 55.20"
    expect(formatLatLon(12.582, 77.0, "dms")).toBe("12°34'55.20\" N, 77°00'00.00\" E");
  });
});
