/**
 * Minimal GPX 1.1 exporter for FlightRecord paths.
 *
 * Pure function — no I/O. Used by the History detail Export tab.
 *
 * @module formats/gpx-exporter
 * @license GPL-3.0-only
 */

export interface GpxTrackPoint {
  lat: number;
  lon: number;
  /** Elevation in meters. Optional. */
  ele?: number;
  /** ISO 8601 timestamp. Optional. */
  time?: string;
}

export interface GpxOptions {
  /** Track name. */
  name: string;
  /** Optional track description. */
  description?: string;
  /** Track points. */
  points: GpxTrackPoint[];
  /** Creator string for the GPX header. */
  creator?: string;
}

/**
 * Build a GPX 1.1 XML document from a sequence of track points.
 * Returns the XML string.
 */
export function buildGpx(options: GpxOptions): string {
  const { name, description, points, creator = "Altnautica Mission Control" } = options;
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const trkpts = points
    .map((p) => {
      const parts = [`<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">`];
      if (p.ele !== undefined) parts.push(`<ele>${p.ele.toFixed(2)}</ele>`);
      if (p.time) parts.push(`<time>${escape(p.time)}</time>`);
      parts.push(`</trkpt>`);
      return parts.join("");
    })
    .join("\n");

  const desc = description ? `\n    <desc>${escape(description)}</desc>` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="${escape(creator)}" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escape(name)}</name>${desc}
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}

/**
 * Trigger a browser download for a GPX file derived from the given points.
 */
export function downloadGpx(filename: string, options: GpxOptions): void {
  const xml = buildGpx(options);
  const blob = new Blob([xml], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".gpx") ? filename : `${filename}.gpx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
