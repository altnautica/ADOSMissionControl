/** Nav-source chip: the shared test vectors N1–N6 plus the remaining rows. */

import { describe, expect, it } from "vitest";

import type { NavState } from "@/lib/hud/nav-types";

import { gpsFixWord, navSourceTextEn, resolveNavSource, sourceValueKey, type NavSourceInput } from "@/lib/hud/nav-source";

function nav(over: Partial<NavState>): NavState {
  return {
    mode: "external_nav",
    activeSet: null,
    extnavHealth: null,
    odomRateHz: null,
    lastResetCounter: null,
    obstacleRateHz: null,
    minObstacleM: null,
    gpsFix: null,
    ...over,
  };
}

function run(over: Partial<NavSourceInput>) {
  const r = resolveNavSource({
    ekf: { flags: 0, ageMs: 100 },
    gps: null,
    nav: null,
    lastCommandedSet: null,
    params: null,
    ...over,
  });
  return { ...navSourceTextEn(r), tone: r.tone, set: r.activeSet };
}

describe("resolveNavSource", () => {
  it("N1 GPS", () => {
    expect(
      run({
        ekf: { flags: 2 + 16, ageMs: 100 },
        gps: { fixType: 3, satellites: 14, hdop: 0.9 },
        params: { EK3_SRC1_POSXY: 3 },
      }),
    ).toEqual({ label: "GPS 3D·14", word: "GOOD", tone: "good", set: 1 });
  });

  it("N2 external nav degraded", () => {
    expect(
      run({
        ekf: { flags: 2 + 8, ageMs: 100 },
        nav: nav({ activeSet: 1, extnavHealth: "degraded" }),
        params: { EK3_SRC1_POSXY: 6 },
      }),
    ).toMatchObject({ label: "EXT NAV", word: "DEGRADED", tone: "warn" });
  });

  it("N3 optical flow on set 2", () => {
    expect(
      run({
        ekf: { flags: 2, ageMs: 100 },
        nav: nav({ activeSet: 2 }),
        params: { EK3_SRC2_POSXY: 0, EK3_SRC2_VELXY: 5 },
      }),
    ).toEqual({ label: "FLOW", word: "HOLD OK", tone: "good", set: 2 });
  });

  it("N4 constant position → DR", () => {
    expect(run({ ekf: { flags: 128, ageMs: 100 } })).toMatchObject({ label: "DR", word: "DRIFT", tone: "crit" });
  });

  it("N5 params unknown, external nav healthy", () => {
    expect(
      run({ ekf: { flags: 2 + 8, ageMs: 100 }, nav: nav({ extnavHealth: "good" }) }),
    ).toMatchObject({ label: "EXT NAV", word: "GOOD", tone: "good" });
  });

  it("N6 stale EKF report", () => {
    expect(run({ ekf: { flags: 2 + 16, ageMs: 2500 } })).toMatchObject({ label: "NAV —", word: null, tone: "muted" });
    expect(run({ ekf: null })).toMatchObject({ label: "NAV —" });
  });

  it("GPS quality rows", () => {
    const base = { ekf: { flags: 2 + 16, ageMs: 0 }, params: { EK3_SRC1_POSXY: 3 } };
    expect(run({ ...base, gps: { fixType: 2, satellites: 5 } })).toMatchObject({ word: "NO FIX", tone: "crit" });
    expect(run({ ...base, ekf: { flags: 2 + 16 + 1024, ageMs: 0 }, gps: { fixType: 3, hdop: 0.8 } })).toMatchObject({
      word: "GLITCH",
      tone: "warn",
    });
    expect(run({ ...base, gps: { fixType: 6, satellites: 20, hdop: 2 } })).toMatchObject({
      label: "GPS RTK FIX·20",
      word: "FAIR",
    });
    expect(run({ ...base, gps: { fixType: 3, hdop: 3 } })).toMatchObject({ label: "GPS 3D", word: "POOR" });
  });

  it("external nav without a health report falls back to the flags", () => {
    const params = { EK3_SRC1_POSXY: 6 };
    expect(run({ ekf: { flags: 2 + 8, ageMs: 0 }, params })).toMatchObject({ word: "GOOD" });
    expect(run({ ekf: { flags: 2, ageMs: 0 }, params })).toMatchObject({ word: "NO FIX", tone: "crit" });
    expect(run({ ekf: { flags: 2 + 8, ageMs: 0 }, params, nav: nav({ extnavHealth: "lost" }) })).toMatchObject({
      word: "LOST",
      tone: "crit",
    });
  });

  it("uses the last commanded set when vision-nav is absent", () => {
    const r = run({
      ekf: { flags: 2, ageMs: 0 },
      lastCommandedSet: 2,
      params: { EK3_SRC1_POSXY: 3, EK3_SRC2_POSXY: 0, EK3_SRC2_VELXY: 5 },
    });
    expect(r).toMatchObject({ label: "FLOW", set: 2 });
  });

  it("derived rows when params are unknown", () => {
    expect(run({ ekf: { flags: 2 + 16, ageMs: 0 }, gps: { fixType: 3, satellites: 9, hdop: 1 } })).toMatchObject({
      label: "GPS 3D·9",
    });
    expect(run({ ekf: { flags: 2, ageMs: 0 } })).toMatchObject({ label: "FLOW", word: "HOLD OK" });
  });

  it("helpers", () => {
    expect(gpsFixWord(5)).toBe("rtkFloat");
    expect(gpsFixWord(0)).toBe("none");
    expect(sourceValueKey(6)).toBe("6");
    expect(sourceValueKey(undefined)).toBe("unknown");
  });
});
