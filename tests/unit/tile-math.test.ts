/**
 * Tile URL round-trip: the offline downloader's write key must equal the
 * on-screen cached layer's read key byte-for-byte, including the `@2x` retina
 * variant and the subdomain scheme. Regression guard for the HiDPI cache-miss
 * on a sharded retina basemap.
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
  tileCountAtZoom,
  totalTileCount,
  clampTileZoom,
  customTileProvider,
  resolveBasemap,
  fieldPackProvider,
  validateTileUrlTemplate,
  type TileProvider,
  type LatLngBounds,
} from "@/lib/tile-math";
import { activeFieldPack } from "@/stores/field-pack-store";

/** How the on-screen layer builds a request URL from a template. */
function readerUrl(provider: TileProvider, x: number, y: number, z: number, retina: boolean): string {
  return resolveTileUrl(provider.url, subdomainsForUrl(provider.url), x, y, z, retina);
}

describe("dark basemap", () => {
  it("is a keyless source", () => {
    const dark = TILE_PROVIDERS.dark;
    expect(dark.url).toBe(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    );
    expect(dark.url).not.toContain("cartocdn");
    expect(dark.maxZoom).toBe(16);
    expect(resolveTileUrl(dark.url, dark.subdomains, 4, 6, 10, true)).toContain("/MapServer/tile/10/6/4");
  });
});

describe("tile URL round-trip (write key == read key)", () => {
  // A sharded retina template, the shape the HiDPI cache-miss came from.
  const sharded: TileProvider = {
    kind: "raster",
    url: "https://{s}.tiles.example.com/{z}/{x}/{y}{r}.png",
    subdomains: ["a", "b", "c"],
    maxZoom: 20,
    avgTileKB: 20,
    attribution: "",
    name: "Sharded",
    label: "SHARD",
  };

  it("sharded + retina: downloader URL matches the layer's request URL byte-for-byte", () => {
    const x = 5, y = 9, z = 14;
    const writer = resolveTileUrl(sharded.url, sharded.subdomains, x, y, z, true);
    const reader = readerUrl(sharded, x, y, z, true);
    expect(writer).toBe(reader);
    expect(writer).toContain("@2x");
    expect(writer.startsWith(`https://${sharded.subdomains[Math.abs(x + y) % 3]}.tiles`)).toBe(true);
  });

  it("sharded + non-retina: no @2x variant, still round-trips", () => {
    const url = resolveTileUrl(sharded.url, sharded.subdomains, 5, 9, 14, false);
    expect(url).not.toContain("@2x");
    expect(url).toBe(readerUrl(sharded, 5, 9, 14, false));
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
    expect(subdomainsForUrl(TILE_PROVIDERS.dark.url)).toEqual([]);
    expect(subdomainsForUrl(TILE_PROVIDERS.osm.url)).toEqual(TILE_PROVIDERS.osm.subdomains);
    expect(subdomainsForUrl("https://example.com/{z}/{x}/{y}.png")).toEqual(["a", "b", "c"]);
  });

  it("generateTileUrls yields exactly the URLs the layer requests (sharded + retina)", () => {
    const bounds: LatLngBounds = { north: 12.98, south: 12.96, east: 77.62, west: 77.60 };
    const z = 14;
    const urls = [...generateTileUrls(bounds, z, z, sharded, true)];
    expect(urls.length).toBeGreaterThan(0);

    const xMin = lonToTileX(bounds.west, z), xMax = lonToTileX(bounds.east, z);
    const yMin = latToTileY(bounds.north, z), yMax = latToTileY(bounds.south, z);
    const expected = new Set<string>();
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        expected.add(readerUrl(sharded, x, y, z, true));
      }
    }
    for (const u of urls) {
      expect(expected.has(u)).toBe(true);
      expect(u).toContain("@2x");
    }
  });
});

describe("tile bounds at the edges of the world", () => {
  const osm = TILE_PROVIDERS.osm;

  it("splits a view panned across the antimeridian into real tile columns", () => {
    // Leaflet reports east = 190 once the map is panned past 180°.
    const bounds: LatLngBounds = { north: 10, south: 0, east: 190, west: 170 };
    const z = 3;
    const xs = new Set(
      [...generateTileUrls(bounds, z, z, osm, false)].map((u) => Number(u.split("/").at(-2))),
    );
    expect([...xs].sort((a, b) => a - b)).toEqual([0, 7]);
    expect(tileCountAtZoom(bounds, z)).toBe(2 * (latToTileY(0, z) - latToTileY(10, z) + 1));
  });

  it("never yields a tile outside the grid for a view wider than the world or past the poles", () => {
    const bounds: LatLngBounds = { north: 90, south: -90, east: 250, west: -250 };
    const z = 2;
    expect(tileCountAtZoom(bounds, z)).toBe(16);
    for (const u of generateTileUrls(bounds, z, z, osm, false)) {
      const [x, y] = u.replace(/\.png$/, "").split("/").slice(-2).map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(4);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(4);
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

  it("field-pack falls back to the hosted vector basemap when no pack is reachable", () => {
    expect(resolveBasemap("field-pack", { url: "", maxZoom: 19, attribution: "" })).toBe(
      TILE_PROVIDERS["streets-dark"],
    );
  });

  it("field-pack resolves to the ground station's pack when one is offered", () => {
    const pack = fieldPackProvider("http://ground.local:8080", { name: "field area", maxzoom: 14 });
    const resolved = resolveBasemap("field-pack", { url: "", maxZoom: 19, attribution: "" }, pack);
    expect(resolved.kind).toBe("vector");
    expect(resolved.maxZoom).toBe(14);
    expect(resolved.url).toBe("http://ground.local:8080/api/v1/ground-station/tiles/field%20area/{z}/{x}/{y}.mvt");
    // Another source never picks up the pack.
    expect(resolveBasemap("satellite", { url: "", maxZoom: 19, attribution: "" }, pack)).toBe(TILE_PROVIDERS.satellite);
  });
});

describe("activeFieldPack", () => {
  const pack = (name: string, usable = true) => ({
    name, usable, bounds: [0, 0, 1, 1] as [number, number, number, number], minzoom: 0, maxzoom: 14,
    tile_type: usable ? ("mvt" as const) : ("png" as const), size_bytes: 1, etag: "e",
  });
  const source = { baseUrl: "http://g:8080", apiKey: "k", packs: [pack("raster", false), pack("a"), pack("b")] };

  it("keeps the chosen pack while it is usable", () => {
    expect(activeFieldPack(source, "b")?.name).toBe("b");
  });

  it("falls back to the first usable pack, never a raster one", () => {
    expect(activeFieldPack(source, "raster")?.name).toBe("a");
    expect(activeFieldPack(source, "gone")?.name).toBe("a");
    expect(activeFieldPack(null, "a")).toBeNull();
  });
});

describe("vector basemap providers", () => {
  it("download URLs are MVT tiles on the hosted vector server", () => {
    const streets = TILE_PROVIDERS["streets-dark"];
    expect(streets.kind).toBe("vector");
    expect(streets.maxZoom).toBe(15);
    const bounds: LatLngBounds = { north: 12.98, south: 12.96, east: 77.62, west: 77.60 };
    const urls = [...generateTileUrls(bounds, 14, 15, streets, true)];
    expect(urls.length).toBe(totalTileCount(bounds, 14, 15));
    for (const u of urls) expect(u).toMatch(/^https:\/\/tiles\.altnautica\.com\/planet\/1[45]\/\d+\/\d+\.mvt$/);
  });

  it("raster providers are marked raster", () => {
    for (const id of ["dark", "osm", "satellite", "terrain"] as const) {
      expect(TILE_PROVIDERS[id].kind).toBe("raster");
    }
  });
});
