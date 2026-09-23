/**
 * @module MapControl
 * @description Container for React UI drawn inside a Leaflet map (a corner
 * control, a picker). Leaflet listens on the map container with its own event
 * system, so a React `stopPropagation` does not stop a click on the control from
 * also reaching the map as a map click (dropping a waypoint under the button),
 * a drag, a double-click zoom or a wheel zoom. This wrapper marks its element
 * with Leaflet's click and scroll propagation guards.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import L from "leaflet";

interface MapControlProps {
  /** Leaflet corner classes, e.g. `leaflet-top leaflet-right`. */
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function MapControl({ className, style, children }: MapControlProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    L.DomEvent.disableScrollPropagation(el);
  }, []);

  return (
    <div ref={ref} className={className} style={{ pointerEvents: "auto", ...style }}>
      {children}
    </div>
  );
}
