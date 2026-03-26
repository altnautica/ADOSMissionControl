"use client";

/**
 * @module MiniMapView
 * @description Compact Leaflet map showing drone position for the Drone Context Rail.
 * @license GPL-3.0-only
 */

import dynamic from "next/dynamic";
import { useAgentSystemStore } from "@/stores/agent-system-store";

const MiniMapInner = dynamic(() => import("./MiniMapInner"), { ssr: false });

export function MiniMapView() {
  const status = useAgentSystemStore((s) => s.status);
  if (!status) return null;

  return (
    <div className="rounded border border-border-default overflow-hidden" style={{ height: 150 }}>
      <MiniMapInner />
    </div>
  );
}
