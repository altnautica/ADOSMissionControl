/**
 * @module cockpit/attitude-honesty.test
 * @description The cockpit artificial horizon must not invent an attitude.
 *
 * With no attitude telemetry an instrument that defaults pitch and roll to 0
 * draws a perfectly wings-level horizon. A pilot glancing at a level ladder
 * believes the aircraft is level, which makes this the worst fabrication
 * class in the HUD: it is indistinguishable from a correct reading. Absent
 * attitude must raise a failure flag instead, and stale telemetry must blank
 * the tapes rather than keep painting the last value.
 *
 * @license GPL-3.0-only
 */

import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";

import { AttitudeIndicator } from "@/components/cockpit/AttitudeIndicator";
import { HudLayer } from "@/components/cockpit/HudLayer";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useCockpitStore } from "@/stores/cockpit-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";

const FLAG = "[data-testid='attitude-flag']";
const HORIZON = "[data-testid='hud-horizon']";

describe("cockpit AttitudeIndicator", () => {
  afterEach(cleanup);

  it("draws the ladder from a live attitude", () => {
    const { container } = render(
      <AttitudeIndicator pitch={-8} roll={22} flightPath={null} attFlagLabel="ATT" />,
    );
    expect(container.querySelector(FLAG)).toBeNull();
    // The roll transform is the instrument actually responding to attitude.
    expect(container.querySelector(HORIZON)?.getAttribute("transform")).toContain(
      "rotate(-22 600 350)",
    );
  });

  it("raises the ATT failure flag when attitude is absent", () => {
    const { container } = render(
      <AttitudeIndicator pitch={null} roll={null} flightPath={null} attFlagLabel="ATT" />,
    );
    expect(container.querySelector(FLAG)?.textContent).toBe("ATT");
    // No horizon, no ladder: nothing an operator could read as level.
    expect(container.querySelector(HORIZON)).toBeNull();
    expect(container.querySelector("[data-rung]")).toBeNull();
    expect(container.innerHTML).not.toContain("rotate(0 600 350)");
  });

  it("raises the flag for a partial or non-finite attitude", () => {
    for (const props of [
      { pitch: 4, roll: null },
      { pitch: null, roll: 3 },
      { pitch: Number.NaN, roll: 0 },
      { pitch: 0, roll: Number.POSITIVE_INFINITY },
    ]) {
      const { container, unmount } = render(
        <AttitudeIndicator {...props} flightPath={null} attFlagLabel="ATT" />,
      );
      expect(container.querySelector(FLAG), JSON.stringify(props)).not.toBeNull();
      expect(container.querySelector(HORIZON), JSON.stringify(props)).toBeNull();
      unmount();
    }
  });

  it("draws a genuine wings-level reading, which must still look level", () => {
    const { container } = render(
      <AttitudeIndicator pitch={0} roll={0} flightPath={null} attFlagLabel="ATT" />,
    );
    expect(container.querySelector(FLAG)).toBeNull();
    expect(container.querySelector("[data-rung='0']")).not.toBeNull();
  });

  it("rungs every 5°, labels every 10°, roll ticks at ±10/20/30/45/60", () => {
    const { container } = render(
      <AttitudeIndicator pitch={0} roll={0} flightPath={null} attFlagLabel="ATT" />,
    );
    const rungs = [...container.querySelectorAll("[data-rung]")].map((el) =>
      Number(el.getAttribute("data-rung")),
    );
    expect(rungs).toEqual(expect.arrayContaining([-10, -5, 0, 5, 10, 15, 20]));
    expect(rungs.every((d) => d % 5 === 0)).toBe(true);
    expect(container.querySelector("[data-rung='5'] text")).toBeNull();
    expect(container.querySelector("[data-rung='10'] text")?.textContent).toBe("10");
    const ticks = [...container.querySelectorAll("[data-roll-tick]")]
      .map((el) => Number(el.getAttribute("data-roll-tick")))
      .sort((a, b) => a - b);
    expect(ticks).toEqual([-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]);
  });

  it("draws the flight-path marker only from a velocity vector", () => {
    const { container, rerender } = render(
      <AttitudeIndicator pitch={5} roll={0} flightPath={null} attFlagLabel="ATT" />,
    );
    expect(container.querySelector("[data-testid='hud-fpm']")).toBeNull();
    rerender(
      <AttitudeIndicator
        pitch={5}
        roll={0}
        flightPath={{ gammaDeg: 0, driftDeg: 0 }}
        attFlagLabel="ATT"
      />,
    );
    // Level flight path, nose 5° up: the marker sits 5° below the boresight.
    const circle = container.querySelector("[data-testid='hud-fpm'] circle");
    expect(circle?.getAttribute("cx")).toBe("600");
    expect(Number(circle?.getAttribute("cy"))).toBeCloseTo(380);
  });
});

describe("cockpit HUD layer from telemetry", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
    useCockpitStore.setState({ altitudeRef: "rel" });
  });
  afterEach(cleanup);

  function pushFlight(ageMs: number) {
    const timestamp = Date.now() - ageMs;
    const s = useTelemetryStore.getState();
    s.pushAttitude({ timestamp, roll: 15, pitch: -6, yaw: 90, rollSpeed: 0, pitchSpeed: 0, yawSpeed: 0 });
    s.pushVfr({ timestamp, airspeed: 12, groundspeed: 11, heading: 90, throttle: 45, alt: 420, climb: 0.4 });
    // MSL 420 m at a site 300 m above sea level: 120 m above home.
    s.pushPosition({
      timestamp,
      lat: 12.97,
      lon: 77.59,
      alt: 420,
      relativeAlt: 120,
      heading: 90,
      groundSpeed: 11,
      airSpeed: 12,
      climbRate: 0.4,
      vn: 0,
      ve: 11,
      vd: -0.4,
    });
  }

  const altValue = () =>
    screen.getByTestId("alt-tape").querySelector("[data-testid='tape-value']")?.textContent;

  it("flies the instruments from fresh telemetry", () => {
    pushFlight(0);
    const { container } = renderWithIntl(<HudLayer />);
    expect(container.querySelector(FLAG)).toBeNull();
    expect(container.querySelector(HORIZON)?.getAttribute("transform")).toContain(
      "rotate(-15 600 350)",
    );
    expect(container.querySelector("[data-testid='hud-fpm']")).not.toBeNull();
    // Altitude is height above home by default, never the MSL figure.
    expect(altValue()).toBe("120");
    expect(screen.getByTestId("heading-value").textContent).toBe("090");
    expect(screen.getByTestId("speed-tape").getAttribute("data-stale")).toBe("false");
    expect(screen.getByTestId("vsi-value").textContent).toBe("+0.4");
  });

  it("switches the altitude tape to MSL and persists the choice", () => {
    pushFlight(0);
    renderWithIntl(<HudLayer />);
    fireEvent.click(screen.getAllByRole("button", { name: /Altitude reference REL/ })[0]);
    expect(useCockpitStore.getState().altitudeRef).toBe("msl");
    expect(altValue()).toBe("420");
  });

  it("flags the horizon and blanks the tapes once telemetry goes stale", () => {
    pushFlight(TELEMETRY_STALE_MS + 1_000);
    const { container } = renderWithIntl(<HudLayer />);

    // The sample is still in the ring; the HUD must not present it.
    expect(useTelemetryStore.getState().attitude.latest()?.roll).toBe(15);
    expect(container.querySelector(FLAG)).not.toBeNull();
    expect(container.innerHTML).not.toContain("rotate(-15 600 350)");
    expect(container.querySelector("[data-testid='hud-fpm']")).toBeNull();
    expect(altValue()).toBe(NO_DATA_GLYPH);
    for (const id of ["speed-tape", "alt-tape", "vsi", "heading-tape"]) {
      expect(screen.getByTestId(id).getAttribute("data-stale"), id).toBe("true");
    }
    expect(screen.getByTestId("heading-value").textContent).toBe(NO_DATA_GLYPH);
  });

  it("hides the wind indicator without a wind estimate", () => {
    pushFlight(0);
    renderWithIntl(<HudLayer />);
    expect(screen.queryByTestId("hud-wind")).toBeNull();
  });
});
