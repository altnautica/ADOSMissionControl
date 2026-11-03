"use client";

/**
 * @module map/local/FollowTargetGeoLayer
 * @description The follow target on the tile (global) minimap: the
 * follow-me `target_ned` placed about the vehicle's EKF origin, as a 10 px
 * outlined diamond with a 1 s velocity tick, dashed in the coast colour while
 * coasting or searching. Hidden when the follow state is stale, the target
 * has no local position, or the origin is unknown. Rendered inside the
 * Leaflet map, so it is loaded client-only.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";
import L from "leaflet";
import { Marker, Polyline } from "react-leaflet";

import { useFollowStateEntry } from "@/hooks/use-nav-feed";
import { followTargetGeo } from "@/lib/nav/ned-geo";
import { FOLLOW_STALE_MS, freshData } from "@/stores/nav-stream-store";
import { useGpsOriginStore } from "@/stores/gps-origin-store";

const DIAMOND = "M0 -5 L5 0 L0 5 L-5 0 Z";

function targetIcon(coast: boolean): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [14, 14],
    iconAnchor: [7, 7],
    html: `<svg width="14" height="14" viewBox="-7 -7 14 14" class="mmap-tgt${coast ? " coast" : ""}" data-follow-target="${coast ? "coast" : "track"}"><path class="halo" d="${DIAMOND}"/><path class="mark" d="${DIAMOND}"/></svg>`,
  });
}

const TRACK_ICON = targetIcon(false);
const COAST_ICON = targetIcon(true);

export function FollowTargetGeoLayer({ droneId }: { droneId: string }) {
  const follow = useFollowStateEntry(droneId);
  const origin = useGpsOriginStore((s) => s.byDrone[droneId] ?? null);
  // The follow state expires at 2 s; re-check once a second.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const geo = followTargetGeo(follow ? freshData(follow, now, FOLLOW_STALE_MS) : null, origin);
  if (!geo) return null;
  return (
    <>
      {geo.tick && (
        <Polyline
          positions={[geo.position, geo.tick]}
          interactive={false}
          pathOptions={{
            className: geo.dashed ? "mmap-tgt-tick coast" : "mmap-tgt-tick",
            weight: 1.5,
            dashArray: geo.dashed ? "3 2" : undefined,
          }}
        />
      )}
      <Marker position={geo.position} icon={geo.dashed ? COAST_ICON : TRACK_ICON} interactive={false} />
    </>
  );
}
