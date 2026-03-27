/**
 * @module KmlOverlayLayers
 * @description Renders KML overlay polygons, polylines, and point markers
 * on the Leaflet map. Display-only (not editable).
 * @license GPL-3.0-only
 */
"use client";

import { Polygon, Polyline, CircleMarker } from "react-leaflet";
import { useOverlayStore, type KmlOverlay } from "@/stores/overlay-store";

function OverlayLayer({ overlay }: { overlay: KmlOverlay }) {
  if (!overlay.visible) return null;

  const { style, opacity } = overlay;

  return (
    <>
      {/* Polygons */}
      {overlay.polygons.map((poly, i) => (
        <Polygon
          key={`${overlay.id}-poly-${i}`}
          positions={poly}
          pathOptions={{
            color: style.lineColor,
            fillColor: style.fillColor,
            fillOpacity: opacity * 0.3,
            opacity: opacity * 0.8,
            weight: style.lineWidth,
          }}
          interactive={false}
        />
      ))}

      {/* Paths */}
      {overlay.paths.map((path, i) => (
        <Polyline
          key={`${overlay.id}-path-${i}`}
          positions={path}
          pathOptions={{
            color: style.lineColor,
            opacity: opacity,
            weight: style.lineWidth,
          }}
          interactive={false}
        />
      ))}

      {/* Points */}
      {overlay.points.map((point, i) => (
        <CircleMarker
          key={`${overlay.id}-point-${i}`}
          center={point}
          radius={4}
          pathOptions={{
            color: style.lineColor,
            fillColor: style.lineColor,
            fillOpacity: opacity * 0.8,
            opacity: opacity,
            weight: 1,
          }}
          interactive={false}
        />
      ))}
    </>
  );
}

export function KmlOverlayLayers() {
  const overlays = useOverlayStore((s) => s.overlays);

  if (overlays.length === 0) return null;

  return (
    <>
      {overlays.map((overlay) => (
        <OverlayLayer key={overlay.id} overlay={overlay} />
      ))}
    </>
  );
}
