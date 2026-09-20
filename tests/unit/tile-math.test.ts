/**
 * Tile URL round-trip: the offline downloader's write key must equal the
 * on-screen cached layer's read key byte-for-byte, including the `@2x` retina
 * variant and the subdomain scheme. Regression guard for the HiDPI cache-miss
 * on the default CARTO "dark" basemap.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  TILE_PROVIDERS,
  resolveTileUrl,
  subdomainsForUrl,
  isRetinaDisplay,
  generateTileUrls,
  lonToTileX,
  latToTileY,
  clampTileZoom,
  customTileProvider,
  resolveBasemap,
  validateTileUrlTemplate,
  type TileProvider,
  type LatLngBounds,
} from "@/lib/tile-math";

/** How the reader (CachedTileLayer) builds a request URL from a template. */
function readerUrl(provider: TileProvider, x: number, y: number, z: number, retina: boolean): string {
  return resolveTileUrl(provider.url, subdomainsForUrl(provider.url), x, y, z, retina);
}

describe("tile URL round-trip (write key == read key)", () => {
  const dark = TILE_PROVIDERS.dark;

  it("dark + retina: downloader URL matches the layer's request URL byte-for-byte", () => {
    const x = 5, y = 9, z = 14;
    const writer = resolveTileUrl(dark.url, dark.subdomains, x, y, z, true);
    const reader = readerUrl(dark, x, y, z, true);
    expect(writer).toBe(reader);
    expect(writer).toContain("@2x");
    // Subdomain is Math.abs(x+y) % 4 over the [a,b,c,d] scheme.
    expect(writer.startsWith(`https://${dark.subdomains[Math.abs(x + y) % 4]}.basemaps`)).toBe(true);
  });

  it("dark + non-retina: no @2x variant, still round-trips", () => {
    const url = resolveTileUrl(dark.url, dark.subdomains, 5, 9, 14, false);
    expect(url).not.toContain("@2x");
    expect(url).toBe(readerUrl(dark, 5, 9, 14, false));
  });

  it("osm round-trips and never gains an @2x slot (no {r} in template)", () => {
    const osm = TILE_PROVIDERS.osm;
    const writer = resolveTileUrl(osm.url, osm.subdomains, 3, 7, 12, true);
    expect(writer).not.toContain("@2x");
    expect(writer).toBe(readerUrl(osm, 3, 7, 12, true));
    expect(writer.startsWith(`https://${osm.subdomains[Math.abs(3 + 7) % 3]}.tile.openstreetmap`)).toBe(true);
  });

  it("satellite has no subdomain slot and no retina slot", () => {
    const sat = TILE_PROVIDERS.satellite;
    const writer = resolveTileUrl(sat.url, sat.subdomains, 4, 6, 10, true);
    expect(writer).not.toContain("{s}");
    expect(writer).not.toContain("@2x");
    expect(writer).toBe(readerUrl(sat, 4, 6, 10, true));
    expect(writer).toContain("/MapServer/tile/10/6/4");
  });

  it("subdomainsForUrl maps known templates and defaults to abc for unknown", () => {
    expect(subdomainsForUrl(dark.url)).toEqual(dark.subdomains);
    expect(subdomainsForUrl(TILE_PROVIDERS.osm.url)).toEqual(TILE_PROVIDERS.osm.subdomains);
    expect(subdomainsForUrl("https://example.com/{z}/{x}/{y}.png")).toEqual(["a", "b", "c"]);
  });

  it("generateTileUrls yields exactly the URLs the layer requests (dark + retina)", () => {
    const bounds: LatLngBounds = { north: 12.98, south: 12.96, east: 77.62, west: 77.60 };
    const z = 14;
    const urls = [...generateTileUrls(bounds, z, z, dark, true)];
    expect(urls.length).toBeGreaterThan(0);

    const xMin = lonToTileX(bounds.west, z), xMax = lonToTileX(bounds.east, z);
    const yMin = latToTileY(bounds.north, z), yMax = latToTileY(bounds.south, z);
    const expected = new Set<string>();
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        expected.add(readerUrl(dark, x, y, z, true));
      }
    }
    for (const u of urls) {
      expect(expected.has(u)).toBe(true);
      expect(u).toContain("@2x");
    }
  });
});

describe("isRetinaDisplay", () => {
  const original = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  afterEach(() => {
    if (original) {
      Object.defineProperty(window, "devicePixelRatio", original);
    }
  });

  it("true when devicePixelRatio > 1", () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    expect(isRetinaDisplay()).toBe(true);
  });

  it("false when devicePixelRatio <= 1", () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true });
    expect(isRetinaDisplay()).toBe(false);
  });
});

describe("custom tile URL templates", () => {
  // The URL from the feature request: two `?` segments, which is exactly what
  // a `new URL(...)` round-trip would mangle.
  const selfHosted =
    "https://localhost/tileserver/tileserver.php?/index.json?/world_countries/{z}/{x}/{y}.png";

  it("accepts a self-hosted template with query segments", () => {
    expect(validateTileUrlTemplate(selfHosted)).toBeNull();
    expect(validateTileUrlTemplate("  http://tiles.lan:8080/{z}/{x}/{y}.png  ")).toBeNull();
  });

  it("rejects an unusable template with a reason the UI can show", () => {
    expect(validateTileUrlTemplate("")).toBe("Enter a tile URL template.");
    expect(validateTileUrlTemplate("ftp://h/{z}/{x}/{y}.png")).toBe(
      "Tile URL must start with http:// or https://.",
    );
    expect(validateTileUrlTemplate("https://h/{z}/{x}.png")).toBe("Tile URL must contain {y}.");
    // `resolveTileUrl` replaces each token once, so a repeat would ship a
    // literal `{y}` in the request URL.
    expect(validateTileUrlTemplate("https://h/{z}/{x}/{y}/{y}.png")).toBe(
      "Tile URL must contain {y} only once.",
    );
    expect(validateTileUrlTemplate("https://h/{z}/{x}/{-y}.png")).toBe(
      "TMS templates ({-y}) are not supported. Use {y}.",
    );
  });

  it("custom provider write key == read key for a {s} template", () => {
    const p = customTileProvider({
      url: "https://{s}.tiles.example.org/{z}/{x}/{y}.png",
      maxZoom: 15,
      attribution: "",
    });
    expect(resolveTileUrl(p.url, p.subdomains, 5, 9, 14, true)).toBe(readerUrl(p, 5, 9, 14, true));
    expect(p.maxZoom).toBe(15);
  });

  it("resolveBasemap falls back to dark for an unusable custom template", () => {
    expect(resolveBasemap("custom", { url: "", maxZoom: 19, attribution: "" })).toBe(
      TILE_PROVIDERS.dark,
    );
    expect(
      resolveBasemap("custom", { url: "https://h/{z}/{x}.png", maxZoom: 19, attribution: "" }),
    ).toBe(TILE_PROVIDERS.dark);
  });

  it("resolveBasemap uses the operator's template and max zoom when usable", () => {
    const resolved = resolveBasemap("custom", {
      url: selfHosted,
      maxZoom: 15,
      attribution: "Local tiles",
    });
    expect(resolved.url).toBe(selfHosted);
    expect(resolved.maxZoom).toBe(15);
    expect(resolved.attribution).toBe("Local tiles");
  });

  it("clampTileZoom keeps an entered zoom inside Leaflet's usable range", () => {
    expect(clampTileZoom(0)).toBe(1);
    expect(clampTileZoom(99)).toBe(24);
    expect(clampTileZoom(Number.NaN)).toBe(19);
  });
});
