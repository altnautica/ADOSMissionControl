/**
 * Replay auto-follow re-centres on real movement only, without an animated
 * pan: the map re-renders on every replayed frame.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

const leaflet = vi.hoisted(() => ({
  setView: vi.fn(),
  /** Screen distance between the drone and the map centre, in pixels. */
  offsetPx: 100,
}));

vi.mock("react-leaflet", () => {
  const point = { distanceTo: () => leaflet.offsetPx };
  const known: Record<string, unknown> = {
    setView: leaflet.setView,
    getZoom: () => 16,
    getCenter: () => ({ lat: 0, lng: 0 }),
    latLngToContainerPoint: () => point,
  };
  const map: object = new Proxy(known, {
    get: (target, key) => (typeof key === "string" && key in target ? target[key] : () => map),
  });
  return {
    MapContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    TileLayer: () => null,
    Marker: () => null,
    Polyline: () => null,
    useMap: () => map,
  };
});

import { ReplayMap } from "../ReplayMap";
import { useTelemetryStore } from "@/stores/telemetry-store";

function pushPosition(lat: number): void {
  useTelemetryStore.getState().pushPosition({
    timestamp: Date.now(),
    lat,
    lon: 77.61,
    alt: 120,
    relativeAlt: 30,
    heading: 90,
    groundSpeed: 5,
    airSpeed: 5,
    climbRate: 0,
  });
}

beforeEach(() => {
  useTelemetryStore.getState().clear();
  leaflet.setView.mockClear();
  leaflet.offsetPx = 100;
});
afterEach(cleanup);

describe("ReplayMap auto-follow", () => {
  it("re-centres without animation, and not again for a sub-pixel move", () => {
    pushPosition(12.99);
    const { rerender } = render(<ReplayMap />);
    expect(leaflet.setView).toHaveBeenCalledTimes(1);
    expect(leaflet.setView.mock.calls[0][2]).toEqual({ animate: false });

    leaflet.offsetPx = 0.5;
    pushPosition(12.990001);
    rerender(<ReplayMap />);
    rerender(<ReplayMap />);
    expect(leaflet.setView).toHaveBeenCalledTimes(1);
  });
});
