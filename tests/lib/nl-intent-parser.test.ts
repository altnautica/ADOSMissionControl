import { describe, it, expect } from "vitest";
import { parseMissionIntent } from "@/lib/nl-intent-parser";

describe("parseMissionIntent", () => {
  it("parses a survey command with altitude and overlap", () => {
    expect(parseMissionIntent("survey this area at 60m with 75% overlap")).toEqual({
      pattern: "survey",
      altitudeM: 60,
      overlapPct: 75,
    });
  });

  it("parses an orbit command with an explicit radius (and no altitude)", () => {
    expect(parseMissionIntent("orbit the tower at radius 80m")).toEqual({
      pattern: "orbit",
      radiusM: 80,
    });
  });

  it("returns null for gibberish", () => {
    expect(parseMissionIntent("asdf qwer zxcv 42 foo")).toBeNull();
  });

  it("returns null for empty / whitespace input", () => {
    expect(parseMissionIntent("")).toBeNull();
    expect(parseMissionIntent("   ")).toBeNull();
  });

  describe("pattern keywords", () => {
    it("maps map/mapping to survey", () => {
      expect(parseMissionIntent("map the field")).toEqual({ pattern: "survey" });
      expect(parseMissionIntent("mapping run")).toEqual({ pattern: "survey" });
    });

    it("maps inspect to orbit", () => {
      expect(parseMissionIntent("inspect the antenna")).toEqual({ pattern: "orbit" });
    });

    it("recognizes corridor and perimeter", () => {
      expect(parseMissionIntent("corridor scan")).toEqual({ pattern: "corridor" });
      expect(parseMissionIntent("fly the perimeter")).toEqual({ pattern: "perimeter" });
    });

    it("picks the earliest-occurring keyword deterministically", () => {
      expect(parseMissionIntent("orbit then survey")?.pattern).toBe("orbit");
      expect(parseMissionIntent("survey then orbit")?.pattern).toBe("survey");
    });

    it("does not match keywords inside larger words", () => {
      // "roadmap" must not trigger the map->survey keyword.
      expect(parseMissionIntent("roadmap")).toBeNull();
    });
  });

  describe("altitude unit variants", () => {
    it('parses "at 50m"', () => {
      expect(parseMissionIntent("survey at 50m")?.altitudeM).toBe(50);
    });

    it('parses "50 metres"', () => {
      expect(parseMissionIntent("survey 50 metres")?.altitudeM).toBe(50);
    });

    it('parses "120 meters"', () => {
      expect(parseMissionIntent("map 120 meters")?.altitudeM).toBe(120);
    });

    it('parses "altitude 50" without a unit', () => {
      expect(parseMissionIntent("orbit altitude 50")?.altitudeM).toBe(50);
    });

    it('parses "height of 80 m"', () => {
      expect(parseMissionIntent("survey height of 80 m")?.altitudeM).toBe(80);
    });

    it("parses decimal altitudes", () => {
      expect(parseMissionIntent("survey at 42.5m")?.altitudeM).toBe(42.5);
    });

    it("does not read a bare unanchored number as altitude", () => {
      // "80" here belongs to the radius, and no altitude anchor is present.
      const intent = parseMissionIntent("orbit radius 80");
      expect(intent?.radiusM).toBe(80);
      expect(intent?.altitudeM).toBeUndefined();
    });
  });

  describe("overlap variants", () => {
    it('parses "75% overlap"', () => {
      expect(parseMissionIntent("survey with 75% overlap")?.overlapPct).toBe(75);
    });

    it('parses a spaced "70 % overlap"', () => {
      expect(parseMissionIntent("survey 70 % overlap")?.overlapPct).toBe(70);
    });

    it('parses the worded "overlap 60"', () => {
      expect(parseMissionIntent("survey overlap 60")?.overlapPct).toBe(60);
    });
  });

  describe("speed variants", () => {
    it('parses "5 m/s"', () => {
      expect(parseMissionIntent("survey at 5 m/s")?.speedMps).toBe(5);
    });

    it('parses "5m/s" without a space', () => {
      expect(parseMissionIntent("orbit 5m/s")?.speedMps).toBe(5);
    });

    it('parses "8 mps"', () => {
      expect(parseMissionIntent("corridor 8 mps")?.speedMps).toBe(8);
    });

    it('parses "speed 5"', () => {
      expect(parseMissionIntent("survey speed 5")?.speedMps).toBe(5);
    });

    it("does not confuse m/s speed with a metre altitude", () => {
      expect(parseMissionIntent("orbit at 5 m/s")?.altitudeM).toBeUndefined();
    });
  });

  describe("radius variants", () => {
    it('parses "radius 100m"', () => {
      expect(parseMissionIntent("orbit radius 100m")?.radiusM).toBe(100);
    });

    it('parses "radius of 80 metres"', () => {
      expect(parseMissionIntent("orbit radius of 80 metres")?.radiusM).toBe(80);
    });

    it("does not let a radius bleed into altitude", () => {
      const intent = parseMissionIntent("orbit radius 100 metres");
      expect(intent?.radiusM).toBe(100);
      expect(intent?.altitudeM).toBeUndefined();
    });
  });

  describe("place extraction", () => {
    it('parses "around <place>" up to the next keyword', () => {
      expect(parseMissionIntent("orbit around downtown at radius 50m")).toEqual({
        pattern: "orbit",
        place: "downtown",
        radiusM: 50,
      });
    });

    it('parses "of <place>" and keeps a multi-word name', () => {
      const intent = parseMissionIntent("map of the north field with 70% overlap at 40m");
      expect(intent?.place).toBe("the north field");
      expect(intent?.pattern).toBe("survey");
      expect(intent?.overlapPct).toBe(70);
      expect(intent?.altitudeM).toBe(40);
    });

    it("does not invent a place when no preposition is present", () => {
      expect(parseMissionIntent("survey this area at 60m")?.place).toBeUndefined();
    });

    it('never takes the number after "radius of" as the place', () => {
      expect(parseMissionIntent("orbit radius of 80m around the tower")).toEqual({
        pattern: "orbit",
        radiusM: 80,
        place: "the tower",
      });
    });

    it('skips "altitude of <number>" and finds the real place', () => {
      const intent = parseMissionIntent("orbit at altitude of 120 metres around the mast");
      expect(intent?.place).toBe("the mast");
      expect(intent?.altitudeM).toBe(120);
    });
  });

  it("combines every field from one rich command", () => {
    expect(
      parseMissionIntent("orbit around the water tower at radius 90m, altitude 45m, speed 6"),
    ).toEqual({
      pattern: "orbit",
      place: "the water tower",
      radiusM: 90,
      altitudeM: 45,
      speedMps: 6,
    });
  });
});
