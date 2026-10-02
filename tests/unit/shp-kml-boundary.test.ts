/**
 * @module tests/unit/shp-kml-boundary
 * @description Ring extraction (outer ring plus interior holes) + lon,lat ->
 * lat,lon swap for the KML/SHP boundary importers. Fixtures are synthetic
 * (generic coordinates only).
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import type { FeatureCollection, Geometry } from "geojson";
import { parseKmlBoundary } from "@/lib/formats/kml-boundary";

// Synthetic shapefile outputs. `shpjs` is mocked so the buffer bytes only need
// to satisfy the zip/bare-.shp magic-byte branch; the geometry comes from here.
const { zipCollection, bareGeometries } = vi.hoisted(() => {
  const zipCollection: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: null,
        geometry: {
          type: "Polygon",
          // GeoJSON lon,lat, closed rings (first == last); ring 1 is a hole.
          coordinates: [
            [
              [10, 20],
              [11, 20],
              [11, 21],
              [10, 21],
              [10, 20],
            ],
            [
              [10.2, 20.2],
              [10.4, 20.2],
              [10.4, 20.4],
              [10.2, 20.2],
            ],
          ],
        },
      },
      {
        // A point feature carries no boundary and must be ignored.
        type: "Feature",
        properties: null,
        geometry: { type: "Point", coordinates: [10, 20] },
      },
    ],
  };

  const bareGeometries: Geometry[] = [
    {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [30, 40],
            [31, 40],
            [31, 41],
            [30, 40],
          ],
        ],
        [
          [
            [50, 60],
            [51, 60],
            [51, 61],
            [50, 60],
          ],
        ],
      ],
    },
  ];

  return { zipCollection, bareGeometries };
});

vi.mock("shpjs", () => {
  const fn = vi.fn(async () => zipCollection);
  return { default: Object.assign(fn, { parseShp: vi.fn(() => bareGeometries) }) };
});

// Import after the mock so the mocked module is picked up.
import shp from "shpjs";
import { parseShapefile, ShapefileNotGeographicError } from "@/lib/formats/shp-import";

function zipBuffer(): ArrayBuffer {
  // PK\x03\x04 local-file-header magic + filler.
  return new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]).buffer;
}

function bareShpBuffer(): ArrayBuffer {
  // Shapefile main-file-header magic (big-endian 9994) — not a zip.
  return new Uint8Array([0x00, 0x00, 0x27, 0x0a, 0x00, 0x00]).buffer;
}

const KML_POLYGON = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Test Boundary</name>
    <Placemark>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>
              10.0,20.0,0 11.0,20.0,0 11.0,21.0,0 10.0,21.0,0 10.0,20.0,0
            </coordinates>
          </LinearRing>
        </outerBoundaryIs>
        <innerBoundaryIs>
          <LinearRing>
            <coordinates>
              10.2,20.2,0 10.4,20.2,0 10.4,20.4,0 10.2,20.2,0
            </coordinates>
          </LinearRing>
        </innerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

const KML_POINT_ONLY = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <Point><coordinates>10.0,20.0,0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;

describe("parseKmlBoundary", () => {
  it("extracts a polygon ring with its hole and swaps lon,lat to lat,lon", () => {
    const boundaries = parseKmlBoundary(KML_POLYGON);
    expect(boundaries).toHaveLength(1);
    // KML lon,lat (10,20) -> our lat,lon (20,10); closing vertex dropped.
    expect(boundaries[0].outer).toEqual([
      [20, 10],
      [20, 11],
      [21, 11],
      [21, 10],
    ]);
    // The interior ring is kept, not silently merged into a solid boundary.
    expect(boundaries[0].holes).toEqual([[
      [20.2, 10.2],
      [20.2, 10.4],
      [20.4, 10.4],
    ]]);
  });

  it("returns an empty array when there is no polygon", () => {
    expect(parseKmlBoundary(KML_POINT_ONLY)).toEqual([]);
  });
});

describe("parseShapefile", () => {
  it("extracts a zipped-bundle polygon with its hole, swapping lon,lat to lat,lon", async () => {
    const boundaries = await parseShapefile(zipBuffer());
    expect(boundaries).toHaveLength(1);
    // GeoJSON lon,lat (10,20) -> our lat,lon (20,10); closing vertex dropped.
    expect(boundaries[0].outer).toEqual([
      [20, 10],
      [20, 11],
      [21, 11],
      [21, 10],
    ]);
    expect(boundaries[0].holes).toEqual([[
      [20.2, 10.2],
      [20.2, 10.4],
      [20.4, 10.4],
    ]]);
  });

  it("extracts every sub-polygon from a bare .shp MultiPolygon, swapped", async () => {
    const boundaries = await parseShapefile(bareShpBuffer());
    expect(boundaries).toHaveLength(2);
    expect(boundaries[0]).toEqual({
      outer: [
        [40, 30],
        [40, 31],
        [41, 31],
      ],
      holes: [],
    });
    expect(boundaries[1]).toEqual({
      outer: [
        [60, 50],
        [60, 51],
        [61, 51],
      ],
      holes: [],
    });
  });

  it("refuses a bare .shp in projected coordinates instead of returning off-planet rings", async () => {
    // UTM easting/northing: no .prj travels with a bare .shp to reproject it.
    vi.mocked(shp.parseShp).mockReturnValueOnce([
      {
        type: "Polygon",
        coordinates: [
          [
            [500000, 4100000],
            [500100, 4100000],
            [500100, 4100100],
            [500000, 4100000],
          ],
        ],
      },
    ]);
    await expect(parseShapefile(bareShpBuffer())).rejects.toBeInstanceOf(
      ShapefileNotGeographicError,
    );
  });
});
