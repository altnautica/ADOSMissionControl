/**
 * @module AirTrafficToolbar
 * @description Top-right toolbar for the Air Traffic viewer.
 * Provides fullscreen toggle, compass reset, and screenshot placeholder.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState, useRef, useEffect } from "react";
import { Maximize, Compass, Camera, MapPin } from "lucide-react";
import { Cartesian3, type Viewer as CesiumViewer } from "cesium";

interface AirTrafficToolbarProps {
  viewer: CesiumViewer | null;
}

export function AirTrafficToolbar({ viewer }: AirTrafficToolbarProps) {
  const t = useTranslations("airTraffic");
  const handleFullscreen = useCallback(() => {
    const container = viewer?.container;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen?.();
    }
  }, [viewer]);

  const handleCompassReset = useCallback(() => {
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: {
        heading: 0,
        pitch: viewer.camera.pitch,
        roll: 0,
      },
      duration: 0.5,
    });
    viewer.scene.requestRender();
  }, [viewer]);

  const handleScreenshot = useCallback(() => {
    if (!viewer || viewer.isDestroyed()) return;
    viewer.scene.requestRender();
    const canvas = viewer.scene.canvas;
    const link = document.createElement("a");
    link.download = `air-traffic-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }, [viewer]);

  const [flyToOpen, setFlyToOpen] = useState(false);
  const flyToRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!flyToOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (flyToRef.current && !flyToRef.current.contains(e.target as Node)) {
        setFlyToOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [flyToOpen]);

  const FLY_TO_LOCATIONS = [
    { name: "Bangalore", lat: 12.97, lon: 77.59, alt: 50_000 },
    { name: "New York", lat: 40.71, lon: -74.01, alt: 50_000 },
    { name: "London", lat: 51.51, lon: -0.13, alt: 50_000 },
    { name: "Dubai", lat: 25.20, lon: 55.27, alt: 50_000 },
    { name: "Tokyo", lat: 35.68, lon: 139.69, alt: 50_000 },
    { name: "Sydney", lat: -33.87, lon: 151.21, alt: 50_000 },
    { name: "Sao Paulo", lat: -23.55, lon: -46.63, alt: 50_000 },
  ];

  const handleFlyTo = useCallback((lat: number, lon: number, alt: number) => {
    if (!viewer || viewer.isDestroyed()) return;
    viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(lon, lat, alt),
      duration: 2,
    });
    setFlyToOpen(false);
  }, [viewer]);

  return (
    <div className="absolute top-14 right-4 z-10 flex flex-col gap-1">
      <ToolbarButton icon={Maximize} title={t("fullscreen")} onClick={handleFullscreen} />
      <ToolbarButton icon={Compass} title={t("resetCompass")} onClick={handleCompassReset} />
      <ToolbarButton icon={Camera} title={t("screenshot")} onClick={handleScreenshot} />
      <div ref={flyToRef} className="relative">
        <ToolbarButton icon={MapPin} title={t("flyToLocation")} onClick={() => setFlyToOpen((o) => !o)} />
        {flyToOpen && (
          <div className="absolute right-10 top-0 w-32 bg-bg-primary/90 backdrop-blur-md border border-border-default rounded-lg overflow-hidden">
            {FLY_TO_LOCATIONS.map((loc) => (
              <button
                key={loc.name}
                onClick={() => handleFlyTo(loc.lat, loc.lon, loc.alt)}
                className="w-full text-left px-3 py-1.5 text-[10px] font-mono text-text-secondary hover:bg-bg-secondary hover:text-text-primary transition-colors cursor-pointer"
              >
                {loc.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  title,
  onClick,
}: {
  icon: typeof Maximize;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-2 bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg hover:bg-bg-secondary transition-colors cursor-pointer"
    >
      <Icon size={14} className="text-text-secondary" />
    </button>
  );
}
