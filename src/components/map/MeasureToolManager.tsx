"use client";

/**
 * @module map/MeasureToolManager
 * @description Owns the DrawingManager that runs the distance-measure tool on
 * a Leaflet map while `active`, and tears it down with the map.
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { DrawingManager } from "@/lib/drawing/drawing-manager";

/** Manages the DrawingManager instance for measurement tool. */
export function MeasureToolManager({ active, onComplete }: { active: boolean; onComplete: () => void }) {
  const map = useMap();
  const managerRef = useRef<DrawingManager | null>(null);

  useEffect(() => {
    if (!managerRef.current) {
      managerRef.current = new DrawingManager(map, {
        onCancel: onComplete,
      });
    }

    if (active) {
      managerRef.current.startMeasure();
    } else {
      managerRef.current.clearAll();
    }

    return () => {
      // Don't destroy on re-render, only on unmount
    };
  }, [map, active, onComplete]);

  useEffect(() => {
    return () => {
      managerRef.current?.destroy();
      managerRef.current = null;
    };
  }, [map]);

  return null;
}
