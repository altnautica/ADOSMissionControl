"use client";

/**
 * Map tab — dynamic-imported wrapper for the Leaflet inner map.
 *
 * @license GPL-3.0-only
 */

import dynamic from "next/dynamic";
import type { FlightRecord } from "@/lib/types";

const MapTabInner = dynamic(() => import("./MapTabInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[320px] items-center justify-center rounded border border-border-default text-[10px] font-mono text-text-tertiary">
      Loading map…
    </div>
  ),
});

interface MapTabProps {
  record: FlightRecord;
}

export function MapTab({ record }: MapTabProps) {
  const hasPath = (record.path?.length ?? 0) >= 2;
  const hasTakeoff = record.takeoffLat !== undefined && record.takeoffLon !== undefined;

  if (!hasPath && !hasTakeoff) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded border border-border-default bg-bg-tertiary">
        <span className="text-[10px] font-mono text-text-tertiary">
          No path data for this flight
        </span>
      </div>
    );
  }

  return <MapTabInner record={record} />;
}
