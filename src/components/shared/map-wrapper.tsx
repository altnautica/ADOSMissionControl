"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useDefaultCenter } from "@/hooks/use-default-center";

const MapContainer = dynamic(
  () => import("react-leaflet").then((m) => m.MapContainer),
  { ssr: false }
);
const TileLayerSwitcher = dynamic(
  () => import("@/components/map/TileLayerSwitcher").then((m) => ({ default: m.TileLayerSwitcher })),
  { ssr: false }
);
const GcsMarker = dynamic(
  () => import("@/components/map/GcsMarker").then((m) => ({ default: m.GcsMarker })),
  { ssr: false }
);
const LocateControl = dynamic(
  () => import("@/components/map/LocateControl").then((m) => ({ default: m.LocateControl })),
  { ssr: false }
);

interface MapWrapperProps {
  center?: [number, number];
  zoom?: number;
  className?: string;
  children?: ReactNode;
}

export function MapWrapper({
  center,
  zoom = 12,
  className = "w-full h-full",
  children,
}: MapWrapperProps) {
  const defaultCenter = useDefaultCenter();
  const mapCenter = center ?? defaultCenter;

  return (
    <div className="isolate w-full h-full">
      <MapContainer
        center={mapCenter}
        zoom={zoom}
        className={className}
        zoomControl={false}
        style={{ background: "#0a0a0a" }}
      >
        <TileLayerSwitcher />
        {children}
        <GcsMarker />
        <LocateControl />
      </MapContainer>
    </div>
  );
}
