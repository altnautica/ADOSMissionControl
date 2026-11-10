/**
 * @license GPL-3.0-only
 *
 * The flight screen's cells stop asserting values they no longer know: the
 * battery and link cells blank a reading past its staleness window, and the
 * bottom row keeps the latched home position (the FC sends HOME_POSITION on
 * connect, arm and set-home only) while never showing the pilot's height
 * above home under the AGL label.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { BatteryCell, LinkCell } from "../TopBarCells";
import { BottomRow } from "../BottomRow";
import { AttitudeRadar } from "../AttitudeRadar";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { BAND_STALE_MS } from "@/hooks/use-hud-topbar-data";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";

const DRONE = "cells-drone";

function battery(ageMs: number): void {
  useTelemetryStore.getState().pushBattery({
    timestamp: Date.now() - ageMs,
    voltage: 22.2,
    current: 8.4,
    remaining: 76,
    consumed: 1200,
  } as never);
}

function radio(ageMs: number): void {
  useTelemetryStore.getState().pushRadio({
    timestamp: Date.now() - ageMs,
    rssi: -55,
    remrssi: -58,
    txbuf: 100,
    noise: 20,
    remnoise: 22,
    rxerrors: 0,
    fixed: 0,
    sourceSystemId: 51,
  } as never);
}

function position(): void {
  useTelemetryStore.getState().pushPosition({
    timestamp: Date.now(),
    lat: 12.9716,
    lon: 77.5946,
    alt: 980,
    relativeAlt: 60,
    groundSpeed: 4,
    climbRate: 0,
  });
}

function cell(key: string): string {
  return screen.getByTestId(`fs-row-${key}`).querySelector(".fs-value")?.textContent ?? "";
}

afterEach(() => {
  cleanup();
  useTelemetryStore.getState().clear();
  useNavStreamStore.setState({ byDrone: {} });
  useDroneStore.setState({ lastHeartbeat: 0 } as never);
});

describe("top bar cells", () => {
  it("shows a fresh battery percentage and blanks a stale one", () => {
    battery(0);
    renderWithIntl(<BatteryCell droneId={DRONE} />);
    expect(screen.getByTestId("fs-battery").textContent).toContain("76%");
    cleanup();
    useTelemetryStore.getState().clear();
    battery(BAND_STALE_MS + 1000);
    renderWithIntl(<BatteryCell droneId={DRONE} />);
    expect(screen.getByTestId("fs-battery").textContent).not.toContain("76");
    expect(screen.getByTestId("fs-battery").textContent).toContain(NO_DATA_GLYPH);
  });

  it("drops a stale RSSI from the link detail", () => {
    useDroneStore.setState({ lastHeartbeat: Date.now() } as never);
    radio(0);
    renderWithIntl(<LinkCell droneId={DRONE} detail />);
    expect(screen.getByTestId("fs-link-detail").textContent).toBe("RSSI -55");
    cleanup();
    useTelemetryStore.getState().clear();
    radio(BAND_STALE_MS + 1000);
    renderWithIntl(<LinkCell droneId={DRONE} detail />);
    expect(screen.getByTestId("fs-link-detail").textContent).not.toContain("-55");
  });
});

describe("bottom row", () => {
  it("keeps the latched home position: D reads with a 10 s old HOME_POSITION", () => {
    useTelemetryStore.getState().pushHomePosition({
      timestamp: Date.now() - 10_000,
      lat: 12.9706,
      lon: 77.5946,
      alt: 920,
    });
    position();
    renderWithIntl(<BottomRow droneId={DRONE} />);
    expect(cell("h")).toBe("60.0 m");
    expect(cell("d")).not.toBe(NO_DATA_GLYPH);
    expect(cell("d")).toMatch(/^1\d\d m$/);
  });

  it("does not show the pilot's height above home as AGL", () => {
    position();
    useNavStreamStore.getState().setPilot(DRONE, { aglM: 60, aglSource: "home" } as never);
    renderWithIntl(<BottomRow droneId={DRONE} />);
    expect(cell("agl")).toBe(NO_DATA_GLYPH);
  });

  it("shows the pilot's rangefinder AGL", () => {
    position();
    useNavStreamStore.getState().setPilot(DRONE, { aglM: 4.2, aglSource: "rangefinder" } as never);
    renderWithIntl(<BottomRow droneId={DRONE} />);
    expect(cell("agl")).toBe("4.2 m");
  });

  it("shows no data, not a fallback 0 m, when the pilot's rangefinder AGL goes stale", () => {
    position();
    useTelemetryStore.getState().pushTerrain({ timestamp: Date.now(), currentHeight: 0 } as never);
    useNavStreamStore.getState().setPilot(DRONE, { aglM: 2.7, aglSource: "rangefinder" } as never, Date.now() - 3000);
    renderWithIntl(<BottomRow droneId={DRONE} />);
    expect(cell("agl")).toBe(NO_DATA_GLYPH);
  });
});

describe("attitude radar", () => {
  it("dims the heading ring and its N mark when the heading is unknown", () => {
    renderWithIntl(<AttitudeRadar droneId={DRONE} size={160} />);
    const ring = screen.getByTestId("fs-attitude-ring");
    expect(ring.getAttribute("data-known")).toBe("false");
    expect(ring.getAttribute("opacity")).toBe("0.35");
    expect(ring.textContent).toContain("N");
  });
});
