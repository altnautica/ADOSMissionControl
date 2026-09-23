/**
 * @license GPL-3.0-only
 *
 * The flight map's home marker is the FC's HOME_POSITION (the point RTL
 * returns to), not the oldest retained trail point, which walks along the
 * track once the trail ring fills and restarts wherever this GCS first saw the
 * drone. Until HOME_POSITION arrives there is no home marker.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

// Lazy map overlays are out of scope; the markers are what is asserted.
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("react-leaflet", () => {
  // Every map method chains back to the map; a pixel distance is a number.
  const map: object = new Proxy(
    {},
    { get: (_t, key) => (key === "distanceTo" ? () => 100 : () => map) },
  );
  return {
    MapContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Marker: ({ position }: { position: [number, number] }) => (
      <div data-testid="marker" data-pos={position.join(",")} />
    ),
    Popup: () => null,
    Polyline: () => null,
    useMap: () => map,
    useMapEvents: () => map,
  };
});

import { OverviewMap } from "../OverviewMap";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useTrailStore } from "@/stores/trail-store";

function markerPositions(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('[data-testid="marker"]')).map((m) =>
    m.getAttribute("data-pos"),
  );
}

beforeEach(() => {
  useTelemetryStore.getState().clear();
  useTrailStore.getState().clear();
  // Connected mid-flight: the oldest trail point is where the GCS first saw
  // the drone, and the drone is now elsewhere.
  useTrailStore.getState().pushPoint(12.98, 77.6, 30);
  useTelemetryStore.getState().pushPosition({
    timestamp: Date.now(),
    lat: 12.99,
    lon: 77.61,
    alt: 120,
    relativeAlt: 30,
    heading: 90,
    groundSpeed: 5,
    airSpeed: 5,
    climbRate: 0,
  });
});
afterEach(cleanup);

describe("OverviewMap home marker", () => {
  it("draws no home until HOME_POSITION arrives, even with a trail", () => {
    const { container } = render(<OverviewMap />);
    expect(markerPositions(container)).toEqual(["12.99,77.61"]);
  });

  it("draws home at HOME_POSITION, not at the oldest trail point", () => {
    useTelemetryStore
      .getState()
      .pushHomePosition({ timestamp: Date.now(), lat: 12.9716, lon: 77.5946, alt: 900 });
    const { container } = render(<OverviewMap />);
    const positions = markerPositions(container);
    expect(positions).toContain("12.9716,77.5946");
    expect(positions).not.toContain("12.98,77.6");
  });
});
