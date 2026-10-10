/**
 * @module cockpit/telemetry-strip-home.test
 * @description DIST/HOME measure to the FC's HOME_POSITION, the point RTL
 * returns to, and read "—" until one has been received. The oldest point of
 * the trail ring is not home: once the ring fills it walks along the flight
 * path, and it restarts wherever this GCS first saw the drone. ETA and GPS
 * quality read from their own fresh sources and never invent a value.
 *
 * @license GPL-3.0-only
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderWithIntl } from "../../../../tests/helpers/intl-wrapper";
import { TelemetryStrip } from "@/components/cockpit/TelemetryStrip";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useTrailStore } from "@/stores/trail-store";

const HOME = { lat: 12.9, lon: 77.5 };
/** About 3.3 km north of home. */
const HERE = { lat: 12.93, lon: 77.5 };

function pushPosition() {
  useTelemetryStore.getState().pushPosition({
    timestamp: Date.now(),
    ...HERE,
    alt: 950,
    relativeAlt: 60,
    heading: 0,
    groundSpeed: 12,
    airSpeed: 12,
    climbRate: 0,
  });
}

/** A long flight path ending near the aircraft: fills and wraps the ring. */
function pushLongTrail() {
  const trail = useTrailStore.getState();
  for (let i = 0; i < 1_500; i++) {
    trail.pushPoint(HERE.lat - 0.00002 * (1_500 - i), HERE.lon);
  }
}

describe("cockpit telemetry strip home distance", () => {
  beforeEach(() => {
    useTelemetryStore.getState().clear();
    useTrailStore.getState().clear();
  });
  afterEach(cleanup);

  it("reads '—' until the FC has reported a home position", () => {
    pushLongTrail();
    pushPosition();
    renderWithIntl(<TelemetryStrip />);
    const dist = screen.getByText("DIST").parentElement;
    const home = screen.getByText("HOME").parentElement;
    expect(dist?.textContent).toBe("DIST— m");
    expect(home?.textContent).not.toMatch(/\d/);
  });

  it("measures to HOME_POSITION, not the oldest trail point", () => {
    pushLongTrail();
    useTelemetryStore.getState().pushHomePosition({ timestamp: Date.now(), ...HOME, alt: 890 });
    pushPosition();
    renderWithIntl(<TelemetryStrip />);
    const dist = screen.getByText("DIST").parentElement;
    // ~3336 m to home; the oldest retained trail point is a few hundred
    // metres behind the aircraft.
    expect(dist?.textContent).toMatch(/33\d\d/);
  });

  it("bears to home and reads ETA to the next waypoint from distance-to-go", () => {
    useTelemetryStore.getState().pushHomePosition({ timestamp: Date.now(), ...HOME, alt: 890 });
    pushPosition();
    useTelemetryStore.getState().pushNavController({
      timestamp: Date.now(),
      navBearing: 0,
      targetBearing: 0,
      wpDist: 120,
      altError: 0,
      xtrackError: 0,
    });
    renderWithIntl(<TelemetryStrip />);
    // Home is due south of the aircraft.
    expect(screen.getByText("HOME").parentElement?.textContent).toBe("HOME180°");
    // 120 m at 12 m/s.
    expect(screen.getByText("ETA").parentElement?.textContent).toBe("ETA0:10");
  });

  it("shows no ETA when not flying to a waypoint, and sats · HDOP from a fresh fix", () => {
    pushPosition();
    useTelemetryStore.getState().pushNavController({
      timestamp: Date.now(),
      navBearing: 0,
      targetBearing: 0,
      wpDist: 0,
      altError: 0,
      xtrackError: 0,
    });
    useTelemetryStore.getState().pushGps({
      timestamp: Date.now(),
      fixType: 3,
      satellites: 14,
      hdop: 0.8,
      lat: HERE.lat,
      lon: HERE.lon,
      alt: 950,
    });
    renderWithIntl(<TelemetryStrip />);
    expect(screen.getByText("ETA").parentElement?.textContent).toBe("ETA—");
    expect(screen.getByText("GPS").parentElement?.textContent).toBe("GPS14 · 0.8");
  });
});
