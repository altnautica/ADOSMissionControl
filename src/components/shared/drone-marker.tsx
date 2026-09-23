"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import L from "leaflet";
import type { DroneStatus } from "@/lib/types";

const Marker = dynamic(
  () => import("react-leaflet").then((m) => m.Marker),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((m) => m.Popup),
  { ssr: false }
);

interface DroneMarkerProps {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Degrees 0-360; undefined when the source reports no heading. */
  heading?: number;
  status: DroneStatus;
  battery?: number;
  onClick?: (id: string) => void;
}

// A divIcon's SVG lives in the document, so theme variables resolve there and
// the marker follows the active theme.
const statusColors: Record<DroneStatus, string> = {
  online: "var(--alt-status-success)",
  in_mission: "var(--alt-accent-primary)",
  idle: "var(--alt-text-secondary)",
  returning: "var(--alt-status-warning)",
  maintenance: "var(--alt-status-error)",
  offline: "var(--alt-text-tertiary)",
};

const droneIconCache = new Map<string, L.DivIcon>();

// With no reported heading the marker is a dot: an arrow would claim a
// direction the vehicle never sent.
function createDroneIcon(heading: number | undefined, status: DroneStatus): L.DivIcon {
  const key = `${heading ?? "none"}-${status}`;
  const cached = droneIconCache.get(key);
  if (cached) return cached;
  const color = statusColors[status];
  const shape =
    heading === undefined
      ? `<circle cx="12" cy="12" r="6" fill="${color}" stroke="var(--alt-bg-primary)" stroke-width="1" opacity="0.9"/>`
      : `<polygon points="12,2 20,20 12,16 4,20" fill="${color}" stroke="var(--alt-bg-primary)" stroke-width="1" opacity="0.9"/>`;
  const rotation = heading === undefined ? "" : ` style="transform:rotate(${heading}deg)"`;
  const svg = `<svg width="24" height="24" viewBox="0 0 24 24"${rotation} xmlns="http://www.w3.org/2000/svg">
    ${shape}
  </svg>`;
  const icon = L.divIcon({
    html: svg,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
  droneIconCache.set(key, icon);
  return icon;
}

export function DroneMarker({ id, name, lat, lon, heading, status, battery, onClick }: DroneMarkerProps) {
  const quantizedHeading = heading === undefined ? undefined : Math.round(heading / 5) * 5;
  const icon = useMemo(() => createDroneIcon(quantizedHeading, status), [quantizedHeading, status]);

  return (
    <Marker
      position={[lat, lon]}
      icon={icon}
      eventHandlers={{
        click: () => onClick?.(id),
      }}
    >
      <Popup>
        <div className="text-xs font-mono text-text-primary bg-bg-primary" style={{ padding: "4px 8px", margin: "-8px -12px" }}>
          <strong>{name}</strong>
          <br />
          {status} {battery !== undefined && battery >= 0 && `| ${Math.round(battery)}%`}
        </div>
      </Popup>
    </Marker>
  );
}
