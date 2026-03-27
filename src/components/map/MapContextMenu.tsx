/**
 * @module MapContextMenu
 * @description Right-click context menu on the fly map. Shows "Fly Here" option
 * that opens a confirmation dialog with altitude picker and hold-to-confirm.
 * Only active when a drone is connected, armed, and in a compatible mode.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useCallback, useState, useMemo } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";
import { useDroneManager } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useGuidedStore } from "@/stores/guided-store";
import { haversineDistance } from "@/lib/telemetry-utils";

const GUIDED_MODES = new Set(["GUIDED", "AUTO", "GUIDED_NOGPS", "LOITER"]);

export function MapContextMenu() {
  const map = useMap();
  const [menuPos, setMenuPos] = useState<{ x: number; y: number; lat: number; lon: number } | null>(null);

  const connectionState = useDroneStore((s) => s.connectionState);
  const flightMode = useDroneStore((s) => s.flightMode);
  const armState = useDroneStore((s) => s.armState);
  const showConfirm = useGuidedStore((s) => s.showConfirm);
  const confirmPending = useGuidedStore((s) => s.confirmPending);

  // Subscribe to position for distance display
  const posBuffer = useTelemetryStore((s) => s.position);
  const latestPos = posBuffer.latest();

  const isConnected = connectionState === "connected";
  const isCompatibleMode = GUIDED_MODES.has(flightMode);
  const isArmed = armState === "armed";
  const canNavigate = isConnected && isCompatibleMode && isArmed;

  // Close menu on map click, move, or when confirm dialog opens
  const closeMenu = useCallback(() => setMenuPos(null), []);

  useEffect(() => {
    if (confirmPending) closeMenu();
  }, [confirmPending, closeMenu]);

  useEffect(() => {
    const onContextMenu = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      if (!canNavigate) return;

      const containerPoint = map.latLngToContainerPoint(e.latlng);
      setMenuPos({
        x: containerPoint.x,
        y: containerPoint.y,
        lat: e.latlng.lat,
        lon: e.latlng.lng,
      });
    };

    map.on("contextmenu", onContextMenu);
    map.on("click", closeMenu);
    map.on("movestart", closeMenu);

    return () => {
      map.off("contextmenu", onContextMenu);
      map.off("click", closeMenu);
      map.off("movestart", closeMenu);
    };
  }, [map, closeMenu, canNavigate]);

  const handleFlyHere = useCallback(() => {
    if (!menuPos) return;
    const rect = map.getContainer().getBoundingClientRect();
    showConfirm(menuPos.lat, menuPos.lon, rect.left + menuPos.x, rect.top + menuPos.y);
    // Menu auto-closes via confirmPending effect above
  }, [menuPos, map, showConfirm]);

  // Compute distance reactively via subscribed position
  const dist = useMemo(() => {
    if (!menuPos || !latestPos) return 0;
    return haversineDistance(latestPos.lat, latestPos.lon, menuPos.lat, menuPos.lon);
  }, [menuPos, latestPos]);

  const distLabel = dist < 1000
    ? `${Math.round(dist)} m`
    : `${(dist / 1000).toFixed(2)} km`;

  if (!menuPos) return null;

  return (
    <div
      className="absolute z-[2000] bg-bg-secondary/95 backdrop-blur-sm border border-border-default rounded-lg shadow-lg overflow-hidden"
      style={{ left: menuPos.x, top: menuPos.y, minWidth: 170 }}
    >
      <button
        onClick={handleFlyHere}
        className="w-full text-left px-3 py-2 text-xs font-mono text-text-primary hover:bg-bg-tertiary transition-colors flex items-center gap-2 cursor-pointer"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M7 1L13 13H1L7 1Z" fill="#3A82FF" fillOpacity="0.6" stroke="#3A82FF" strokeWidth="1"/>
        </svg>
        Fly Here
      </button>
      <div className="border-t border-border-default" />
      <div className="px-3 py-1.5 text-[9px] font-mono text-text-tertiary flex justify-between">
        <span>{menuPos.lat.toFixed(6)}, {menuPos.lon.toFixed(6)}</span>
        {dist > 0 && <span>{distLabel}</span>}
      </div>
    </div>
  );
}
