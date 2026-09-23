/**
 * @license GPL-3.0-only
 *
 * The flight map's GPS badge and drone marker read only fresh telemetry: the
 * rings keep their last sample after the link dies, so a frozen "3D Fix | 14
 * SAT" would otherwise stay green indefinitely. The marker icons are cached so
 * a telemetry sample does not rebuild every marker's DOM, and the follower
 * re-centres only on a visible move, without restarting a pan animation.
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

const leaflet = vi.hoisted(() => ({
  setView: vi.fn(),
  /** Screen distance between the drone and the map centre, in pixels. */
  offsetPx: 100,
  icons: [] as unknown[],
}));

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("react-leaflet", () => {
  const point = { distanceTo: () => leaflet.offsetPx };
  const known: Record<string, unknown> = {
    setView: leaflet.setView,
    getZoom: () => 17,
    getCenter: () => ({ lat: 0, lng: 0 }),
    latLngToContainerPoint: () => point,
  };
  // Every other map method chains back to the map.
  const map: object = new Proxy(known, {
    get: (target, key) => (typeof key === "string" && key in target ? target[key] : () => map),
  });
  return {
    MapContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Marker: ({ icon }: { icon?: unknown }) => {
      leaflet.icons.push(icon);
      return <div data-testid="marker" />;
    },
    Popup: () => null,
    Polyline: () => null,
    useMap: () => map,
    useMapEvents: () => map,
  };
});

import { OverviewMap } from "../OverviewMap";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

function pushPosition(ageMs: number, heading = 90, lat = 12.99): void {
  useTelemetryStore.getState().pushPosition({
    timestamp: Date.now() - ageMs,
    lat,
    lon: 77.61,
    alt: 120,
    relativeAlt: 30,
    heading,
    groundSpeed: 5,
    airSpeed: 5,
    climbRate: 0,
  });
}

function pushGps(ageMs: number): void {
  useTelemetryStore.getState().pushGps({
    timestamp: Date.now() - ageMs,
    fixType: 3,
    satellites: 14,
    hdop: 0.8,
    lat: 12.99,
    lon: 77.61,
    alt: 120,
  });
}

beforeEach(() => {
  useTelemetryStore.getState().clear();
  leaflet.setView.mockClear();
  leaflet.offsetPx = 100;
  leaflet.icons = [];
});
afterEach(cleanup);

describe("OverviewMap GPS badge", () => {
  it("reads unknown, not '0 SAT', before any GPS report", () => {
    const { container } = render(<OverviewMap />);
    expect(container.textContent).toContain("-- | -- SAT");
    expect(container.textContent).toContain("NO GPS FIX");
  });

  it("shows a fresh fix", () => {
    pushGps(0);
    pushPosition(0);
    const { container } = render(<OverviewMap />);
    expect(container.textContent).toContain("14 SAT");
  });

  it("blanks the fix and flags the position stale after link loss", () => {
    pushGps(TELEMETRY_STALE_MS + 1_000);
    pushPosition(TELEMETRY_STALE_MS + 1_000);
    const { container } = render(<OverviewMap />);
    expect(container.textContent).not.toContain("14 SAT");
    expect(container.textContent).toContain("POSITION STALE");
    expect(container.querySelector('[data-testid="marker"]')).toBeNull();
  });
});

describe("OverviewMap rendering cost", () => {
  it("reuses the marker icon for a heading change below the cache step", () => {
    pushPosition(0, 90);
    const { rerender } = render(<OverviewMap />);
    const first = leaflet.icons.at(-1);
    const renders = leaflet.icons.length;
    pushPosition(0, 91);
    rerender(<OverviewMap />);
    expect(leaflet.icons.length).toBeGreaterThan(renders);
    expect(leaflet.icons.at(-1)).toBe(first);
  });

  it("re-centres without animation, and not for a sub-pixel move", () => {
    pushPosition(0);
    const { rerender } = render(<OverviewMap />);
    expect(leaflet.setView).toHaveBeenCalledTimes(1);
    expect(leaflet.setView.mock.calls[0][2]).toEqual({ animate: false });

    leaflet.offsetPx = 0.5;
    pushPosition(0, 90, 12.990001);
    rerender(<OverviewMap />);
    expect(leaflet.setView).toHaveBeenCalledTimes(1);

    leaflet.offsetPx = 40;
    pushPosition(0, 90, 12.9905);
    rerender(<OverviewMap />);
    expect(leaflet.setView).toHaveBeenCalledTimes(2);
  });
});
