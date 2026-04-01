/**
 * @module PoiMarkerOverlay
 * @description Renders POI markers on the Leaflet map with labels and delete on click.
 * @license GPL-3.0-only
 */

"use client";

import { usePoiStore } from "@/stores/poi-store";
import { Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { useMemo } from "react";

function createPoiIcon(label: string, color: string): L.DivIcon {
  const escapedLabel = label.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return L.divIcon({
    className: "",
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    html: `<div style="position:relative">
      <svg width="12" height="12" viewBox="0 0 12 12">
        <circle cx="6" cy="6" r="5" fill="${color}" fill-opacity="0.7" stroke="${color}" stroke-width="1"/>
      </svg>
      <span style="position:absolute;left:14px;top:-3px;white-space:nowrap;font-size:10px;font-family:monospace;color:${color};text-shadow:0 0 3px #000,0 0 6px #000">${escapedLabel}</span>
    </div>`,
  });
}

export function PoiMarkerOverlay() {
  const markers = usePoiStore((s) => s.markers);
  const removeMarker = usePoiStore((s) => s.removeMarker);

  const icons = useMemo(
    () => markers.map((m) => createPoiIcon(m.label, m.color)),
    [markers],
  );

  return (
    <>
      {markers.map((m, i) => (
        <Marker key={m.id} position={[m.lat, m.lon]} icon={icons[i]}>
          <Popup>
            <div
              className="text-xs font-mono"
              style={{
                color: "#fafafa",
                background: "#0a0a0a",
                padding: "6px 10px",
                margin: "-8px -12px",
              }}
            >
              <strong>{m.label}</strong>
              <br />
              <span className="text-[10px] opacity-70">
                {m.lat.toFixed(6)}, {m.lon.toFixed(6)}
              </span>
              <br />
              <button
                onClick={() => removeMarker(m.id)}
                className="mt-1 text-[10px] text-red-400 hover:text-red-300 underline cursor-pointer"
              >
                Remove
              </button>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}
