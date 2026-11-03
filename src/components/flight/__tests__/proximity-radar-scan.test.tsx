/**
 * @license GPL-3.0-only
 *
 * The radar's companion view through the component: scan dots (R1), the
 * nearest-obstacle readout (R2), the display range (auto and pinned), the
 * header rate, and the hidden / stale states.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";

import messages from "../../../../locales/en.json";
import { ProximityRadar } from "@/components/flight/ProximityRadar";
import { buildRadarModel, radarDial } from "@/components/flight/proximity-radar-model";
import type { NavScan, NavState } from "@/lib/agent/nav-types";
import type { ObstacleData } from "@/lib/types/telemetry";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

const DRONE = "node:radar-test";
const UNKNOWN = 65535;
/** Size at which the outer radius is exactly 60 px (spec vector R1). */
const SIZE_R60 = (60 * 120) / 52;

function scanWith(entries: Record<number, number>): NavScan {
  const ranges = new Array<number>(360).fill(0);
  for (const [i, r] of Object.entries(entries)) ranges[Number(i)] = r;
  return { frame: "body_frd", angleStartRad: 0, angleIncrementRad: Math.PI / 180, ranges };
}

function obstacle(distances: Record<number, number>, at = Date.now()): ObstacleData {
  const d = new Array<number>(72).fill(UNKNOWN);
  for (const [i, v] of Object.entries(distances)) d[Number(i)] = v;
  return {
    timestamp: at,
    distances: d,
    minDistance: 20,
    maxDistance: 1000,
    increment: 5,
    incrementF: 0,
    angleOffset: 0,
    frame: 12,
  };
}

const NAV: NavState = {
  mode: "external_nav",
  activeSet: 1,
  extnavHealth: "good",
  odomRateHz: 30,
  lastResetCounter: 0,
  obstacleRateHz: 10,
  minObstacleM: null,
  gpsFix: 0,
};

function renderRadar(size?: number) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ProximityRadar droneId={DRONE} size={size} />
    </NextIntlClientProvider>,
  );
}

describe("ProximityRadar companion view", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
    useNavStreamStore.getState().clear(DRONE);
  });
  afterEach(() => cleanup());

  it("is hidden until OBSTACLE_DISTANCE or a scan has ever arrived", () => {
    const { container } = renderRadar();
    expect(container.querySelector(".radar")).toBeNull();
  });

  it("R1: a 2.0 m return at 90° on a 6 m dial of radius 60 sits at (cx + 20, cy)", () => {
    useNavStreamStore.getState().setScan(DRONE, scanWith({ 90: 2.0 }));
    const { container } = renderRadar(SIZE_R60);
    const { c, R } = radarDial(SIZE_R60);
    expect(R).toBeCloseTo(60);
    const dots = container.querySelectorAll("[data-dot]");
    expect(dots).toHaveLength(1);
    expect(Number(dots[0].getAttribute("cx"))).toBeCloseTo(c + 20);
    expect(Number(dots[0].getAttribute("cy"))).toBeCloseTo(c);
    expect(container.querySelector("[data-ref]")?.textContent).toBe("FWD");
    expect(container.textContent).toContain("AUTO 6 m");
    expect(container.textContent).toContain("2.0 m CAUTION");
  });

  it("R2: a nearest sector at 180 cm reads 1.8 m DANGER with an outlined arc", () => {
    useTelemetryStore.getState().obstacle.push(obstacle({ 0: 180 }));
    const { container } = renderRadar(140);
    expect(container.textContent).toContain("1.8 m DANGER");
    expect(container.querySelectorAll("[data-sector='crit']")).toHaveLength(1);
    expect(container.querySelectorAll("[data-arc]")).toHaveLength(1);
    // Nothing within 1.5 m, something within 6 m: auto picks 6 m.
    expect(container.textContent).toContain("AUTO 6 m");
  });

  it("takes the nearest of the nav report, the sectors and the scan", () => {
    useTelemetryStore.getState().obstacle.push(obstacle({ 0: 400 }));
    useNavStreamStore.getState().setScan(DRONE, scanWith({ 10: 3.2 }));
    useNavStreamStore.getState().setNav(DRONE, { ...NAV, minObstacleM: 1.2 });
    const { container } = renderRadar(140);
    expect(container.textContent).toContain("1.2 m DANGER");
    expect(container.textContent).toContain("LIDAR 10 Hz");
  });

  it("shows SCAN — without a nav rate and CLEAR when nothing is near", () => {
    useNavStreamStore.getState().setScan(DRONE, scanWith({}));
    const { container } = renderRadar(140);
    expect(container.textContent).toContain("SCAN —");
    expect(container.textContent).toContain("CLEAR");
    expect(container.textContent).toContain("AUTO 12 m");
  });

  it("tapping the dial pins 3 → 6 → 12 → auto, and +/− step the range", () => {
    useNavStreamStore.getState().setScan(DRONE, scanWith({ 0: 4 }));
    const { container } = renderRadar(140);
    const dial = container.querySelector(".radar") as HTMLElement;
    fireEvent.click(dial);
    expect(container.querySelector(".rscale")?.textContent).toBe("3 m");
    fireEvent.click(dial);
    expect(container.querySelector(".rscale")?.textContent).toBe("6 m");
    fireEvent.click(dial);
    expect(container.querySelector(".rscale")?.textContent).toBe("12 m");
    fireEvent.click(dial);
    expect(container.querySelector(".rscale")?.textContent).toBe("AUTO 6 m");
    fireEvent.keyDown(dial, { key: "-" });
    expect(container.querySelector(".rscale")?.textContent).toBe("12 m");
    fireEvent.keyDown(dial, { key: "+" });
    expect(container.querySelector(".rscale")?.textContent).toBe("6 m");
    // Ring labels follow the display range.
    const rings = [...container.querySelectorAll("[data-ring]")].map((n) => n.textContent);
    expect(rings).toEqual(["2", "4", "6"]);
  });

  it("dims with a — readout when both sources are older than 2 s", () => {
    act(() => {
      useTelemetryStore.getState().obstacle.push(obstacle({ 0: 150 }, Date.now() - 3000));
      useNavStreamStore.getState().setScan(DRONE, scanWith({ 0: 1 }), Date.now() - 3000);
    });
    const { container } = renderRadar(140);
    const radar = container.querySelector(".radar");
    expect(radar?.getAttribute("data-stale")).toBe("true");
    expect(container.querySelector(".rlabel")?.textContent).toBe("—");
    expect(container.querySelectorAll("[data-dot]")).toHaveLength(0);
    expect(container.querySelectorAll("[data-sector]")).toHaveLength(0);
  });
});

describe("buildRadarModel", () => {
  const base = {
    size: 120,
    obstacle: undefined,
    scan: undefined,
    nav: null,
    yawDeg: null,
    setting: "auto" as const,
    lowPower: false,
  };

  it("drops scan dots older than 500 ms but keeps the readout for 2 s", () => {
    const now = 10_000;
    const m = buildRadarModel({
      ...base,
      now,
      scan: { data: scanWith({ 0: 1 }), receivedAt: now - 800 },
    });
    expect(m.dots).toHaveLength(0);
    expect(m.nearestM).toBe(1);
    expect(m.displayM).toBe(3);
  });

  it("caps dots at 120 in low power", () => {
    const now = 10_000;
    const all = scanWith(Object.fromEntries(Array.from({ length: 360 }, (_, i) => [i, 1])));
    const m = buildRadarModel({ ...base, now, lowPower: true, scan: { data: all, receivedAt: now } });
    expect(m.dots).toHaveLength(120);
  });

  it("rotates north-aligned sectors into the body frame when drawn with a scan", () => {
    const now = 10_000;
    const north = { ...obstacle({ 18: 150 }, now), frame: 0 }; // sector at 90° (east)
    const m = buildRadarModel({
      ...base,
      now,
      obstacle: north,
      yawDeg: 90,
      scan: { data: scanWith({}), receivedAt: now },
    });
    expect(m.reference).toBe("forward");
    // East with the nose east is straight ahead: the arc starts near the top.
    const y = Number(/^M \S+ (\S+)/.exec(m.sectors[0].arc ?? "")?.[1]);
    expect(y).toBeLessThan(60);
  });
});
