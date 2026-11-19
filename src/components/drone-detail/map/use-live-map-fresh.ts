/**
 * @module drone-detail/map/use-live-map-fresh
 * @description Whether a drone's Navigation is publishing a live map: its
 * `map_status` arrived within its source's freshness budget (the 1 Hz LAN
 * nav stream, or the slower heartbeat slice through the cloud). Re-evaluated
 * each second while a status exists, so the Map tab appears and goes with the
 * map. Demo mode always has one: the demo drones fly the synthetic room, and
 * the Map tab starts that feed when it opens.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useState } from "react";

import { mapStatusLive } from "@/components/drone-detail/map/map-status-view";
import { useMapStatusEntry } from "@/hooks/use-nav-feed";
import { isDemoMode } from "@/lib/utils";
import { useNavStreamStore } from "@/stores/nav-stream-store";

export function useLiveMapFresh(droneId: string): boolean {
  const entry = useMapStatusEntry(droneId);
  const streamEntry = useNavStreamStore((s) => s.byDrone[droneId]?.map);
  const [now, setNow] = useState(() => Date.now());
  const hasEntry = entry !== null;
  useEffect(() => {
    if (!hasEntry) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasEntry]);
  if (isDemoMode()) return true;
  return mapStatusLive(entry, now, entry && entry === streamEntry ? "stream" : "heartbeat");
}
