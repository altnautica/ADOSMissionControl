import { describe, it, expect } from "vitest";
import { checkAirportProximity } from "../airspace-check";

const LAX = { lat: 33.9416, lon: -118.4085 };

describe("checkAirportProximity", () => {
  it("raises an error for a waypoint sitting on an airport", () => {
    const issues = checkAirportProximity([{ ...LAX }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("error");
    expect(issues[0].airport.icao).toBe("KLAX");
    expect(issues[0].distanceKm).toBeLessThan(1);
    expect(issues[0].waypointIndex).toBe(0);
    expect(issues[0].message).toContain("KLAX");
  });

  it("returns no issues for a waypoint far from any airport", () => {
    // Remote South Pacific point.
    const issues = checkAirportProximity([{ lat: -40, lon: -140 }]);
    expect(issues).toHaveLength(0);
  });

  it("raises a warning (not error) inside the outer ring only", () => {
    // ~6.5 km due north of LAX: outside the 5 km error ring, inside the 8 km
    // warn ring. One degree of latitude is ~111 km, so 0.0585 deg ~= 6.5 km.
    const wp = { lat: LAX.lat + 0.0585, lon: LAX.lon };
    const issues = checkAirportProximity([wp]);
    expect(issues).toHaveLength(1);
    expect(issues[0].level).toBe("warn");
    expect(issues[0].distanceKm).toBeGreaterThan(5);
    expect(issues[0].distanceKm).toBeLessThan(8);
  });

  it("deduplicates to the closest approach per airport", () => {
    const issues = checkAirportProximity([
      { lat: LAX.lat + 0.02, lon: LAX.lon }, // ~2.2 km
      { ...LAX }, // on field
      { lat: LAX.lat + 0.03, lon: LAX.lon }, // ~3.3 km
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].waypointIndex).toBe(1); // the closest one
    expect(issues[0].level).toBe("error");
  });

  it("honors custom ring radii", () => {
    // With a tiny error ring, an on-field waypoint should still be an error;
    // with a tiny warn ring, a nearby-but-outside waypoint yields nothing.
    const near = { lat: LAX.lat + 0.05, lon: LAX.lon }; // ~5.5 km
    expect(checkAirportProximity([near], { warnKm: 4, errorKm: 2 })).toHaveLength(0);
    expect(checkAirportProximity([near], { warnKm: 10, errorKm: 4 })[0].level).toBe("warn");
  });

  it("ignores waypoints with non-finite coordinates", () => {
    const issues = checkAirportProximity([{ lat: NaN, lon: NaN }, { ...LAX }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].waypointIndex).toBe(1);
  });

  it("flags a leg that overflies an airport between two distant waypoints", () => {
    // ~9 km west and ~9 km east of the field: both waypoints sit outside the
    // 8 km ring, but the straight leg between them crosses the runway.
    const dLon = 9 / (111.32 * Math.cos((LAX.lat * Math.PI) / 180));
    const issues = checkAirportProximity([
      { lat: LAX.lat, lon: LAX.lon - dLon },
      { lat: LAX.lat, lon: LAX.lon + dLon },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0].airport.icao).toBe("KLAX");
    expect(issues[0].level).toBe("error");
    expect(issues[0].onLeg).toBe(true);
    expect(issues[0].waypointIndex).toBe(0);
    expect(issues[0].distanceKm).toBeLessThan(0.1);
    expect(issues[0].message).toContain("WP1→WP2");
  });
});
