/**
 * @module cockpit/telemetry-strip-home.test
 * @description DIST/HOME measure to the FC's HOME_POSITION, the point RTL
 * returns to, and read "--" until one has been received. The oldest point of
 * the trail ring is not home: once the ring fills it walks along the flight
 * path, and it restarts wherever this GCS first saw the drone.
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

  it("reads '--' until the FC has reported a home position", () => {
    pushLongTrail();
    pushPosition();
    renderWithIntl(<TelemetryStrip />);
    const dist = screen.getByText("DIST").parentElement;
    const home = screen.getByText("HOME").parentElement;
    expect(dist?.textContent).toBe("DIST-- m");
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
});
