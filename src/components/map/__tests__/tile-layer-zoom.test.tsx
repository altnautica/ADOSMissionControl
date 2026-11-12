/**
 * A raster basemap that stops short of the map's zoom range (the dark
 * basemap's server ends at 16) is stretched past its last level, never a cap
 * on how far in the main, planner, flight and replay maps zoom.
 *
 * @license GPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

const captured = vi.hoisted(() => ({
  leafletOptions: [] as Record<string, unknown>[],
  layerProps: [] as Record<string, unknown>[],
}));

vi.mock("leaflet", async (orig) => {
  const actual = (await orig<{ default: Record<string, unknown> }>()).default;
  const layer = { addTo: () => layer, on: () => layer };
  return {
    default: {
      ...actual,
      tileLayer: (_url: string, options: Record<string, unknown>) => {
        captured.leafletOptions.push(options);
        return layer;
      },
    },
  };
});

vi.mock("react-leaflet", () => {
  const map: object = new Proxy(
    { getZoom: () => 16, getCenter: () => ({ lat: 0, lng: 0 }) } as Record<string, unknown>,
    { get: (target, key) => (typeof key === "string" && key in target ? target[key] : () => map) },
  );
  return {
    MapContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    TileLayer: (props: Record<string, unknown>) => {
      captured.layerProps.push(props);
      return null;
    },
    Marker: () => null,
    Polyline: () => null,
    Polygon: () => null,
    Tooltip: () => null,
    useMap: () => map,
  };
});

import { renderWithIntl as render } from "../../../../tests/helpers/intl-wrapper";
import { TileLayerSwitcher } from "../TileLayerSwitcher";
import { ReplayMap } from "@/components/history/ReplayMap";
import { useSettingsStore } from "@/stores/settings-store";
import { MAP_MAX_ZOOM, TILE_PROVIDERS } from "@/lib/tile-math";

afterEach(() => {
  cleanup();
  captured.leafletOptions.length = 0;
  captured.layerProps.length = 0;
});

describe("dark basemap zoom range", () => {
  it("lets the main, planner and flight maps zoom to 20 on a basemap that ends at 16", () => {
    useSettingsStore.setState({ mapTileSource: "dark" });
    render(<TileLayerSwitcher showControls={false} />);
    const options = captured.leafletOptions.at(-1);
    expect(options?.maxNativeZoom).toBe(TILE_PROVIDERS.dark.maxZoom);
    expect(options?.maxZoom).toBe(20);
  });

  it("keeps a deeper custom server's own depth", () => {
    useSettingsStore.setState({
      mapTileSource: "custom",
      customTileUrl: "https://tiles.example.invalid/{z}/{x}/{y}.png",
      customTileMaxZoom: 22,
    });
    render(<TileLayerSwitcher showControls={false} />);
    const options = captured.leafletOptions.at(-1);
    expect(options?.maxNativeZoom).toBe(22);
    expect(options?.maxZoom).toBe(22);
  });

  it("lets the replay map zoom past the basemap's last level", () => {
    render(<ReplayMap />);
    const props = captured.layerProps.find((p) => p.url === TILE_PROVIDERS.dark.url);
    expect(props?.maxNativeZoom).toBe(TILE_PROVIDERS.dark.maxZoom);
    expect(props?.maxZoom).toBe(MAP_MAX_ZOOM);
  });
});
