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
  heading: number;
  status: DroneStatus;
  battery?: number;
  onClick?: (id: string) => void;
}

const statusColors: Record<DroneStatus, string> = {
  online: "#22c55e",
  in_mission: "#3a82ff",
  idle: "#a0a0a0",
  returning: "#f59e0b",
  maintenance: "#ef4444",
  offline: "#666666",
};

const droneIconCache = new Map<string, L.DivIcon>();

function createDroneIcon(heading: number, status: DroneStatus): L.DivIcon {
  const key = `${heading}-${status}`;
  const cached = droneIconCache.get(key);
  if (cached) return cached;
  const color = statusColors[status];
  const svg = `<svg width="24" height="24" viewBox="0 0 24 24" style="transform:rotate(${heading}deg)" xmlns="http://www.w3.org/2000/svg">
    <polygon points="12,2 20,20 12,16 4,20" fill="${color}" stroke="#000" stroke-width="1" opacity="0.9"/>
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
  const quantizedHeading = Math.round(heading / 5) * 5;
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
        <div className="text-xs font-mono" style={{ color: "#fafafa", background: "#0a0a0a", padding: "4px 8px", margin: "-8px -12px" }}>
          <strong>{name}</strong>
          <br />
          {status} {battery !== undefined && `| ${Math.round(battery)}%`}
        </div>
      </Popup>
    </Marker>
  );
}
