/**
 * @module LocateControl
 * @description Map control button that flies to the user's GPS position.
 * If location is not enabled, clicking enables it and requests permission.
 * Uses Leaflet control container positioning (bottom-right).
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useMemo } from "react";
import { useMap } from "react-leaflet";
import { LocateFixed, Locate } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useGcsLocationStore } from "@/stores/gcs-location-store";
import { MapControl } from "./MapControl";

interface LocateControlProps {
  style?: React.CSSProperties;
}

export function LocateControl({ style }: LocateControlProps) {
  const map = useMap();
  const locationEnabled = useSettingsStore((s) => s.locationEnabled);
  const setLocationEnabled = useSettingsStore((s) => s.setLocationEnabled);
  const position = useGcsLocationStore((s) => s.position);
  const requestPermission = useGcsLocationStore((s) => s.requestPermission);
  const startWatching = useGcsLocationStore((s) => s.startWatching);

  const hasPosition = locationEnabled && position !== null;

  const iscentered = useMemo(() => {
    if (!hasPosition || !position) return false;
    const center = map.getCenter();
    return (
      Math.abs(center.lat - position.lat) < 0.0001 &&
      Math.abs(center.lng - position.lon) < 0.0001
    );
  }, [hasPosition, position, map]);

  const handleClick = useCallback(async () => {
    if (hasPosition && position) {
      map.flyTo([position.lat, position.lon], 15);
      return;
    }

    // Enable location and request permission in one tap
    setLocationEnabled(true);
    const perm = await requestPermission();
    if (perm === "granted") {
      startWatching();
      const pos = useGcsLocationStore.getState().position;
      if (pos) {
        map.flyTo([pos.lat, pos.lon], 15);
      }
    } else {
      setLocationEnabled(false);
    }
  }, [hasPosition, position, map, setLocationEnabled, requestPermission, startWatching]);

  const Icon = hasPosition ? LocateFixed : Locate;
  const active = hasPosition && iscentered;

  return (
    <MapControl className="leaflet-bottom leaflet-right" style={style}>
      <div className="leaflet-control" style={{ marginBottom: 10, marginRight: 10 }}>
        <button
          onClick={handleClick}
          className={`bg-bg-primary border px-1.5 py-1.5 transition-colors ${
            active
              ? "border-accent-primary text-accent-primary"
              : hasPosition
                ? "border-border-default text-text-secondary hover:text-text-primary"
                : "border-border-default text-text-tertiary hover:text-text-secondary"
          }`}
          title={hasPosition ? "Fly to my location" : "Enable location"}
        >
          <Icon size={14} />
        </button>
      </div>
    </MapControl>
  );
}
