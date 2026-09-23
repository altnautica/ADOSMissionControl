/**
 * @module plan-library
 * @description Utility functions for the flight plan library.
 * Search, sort, tree building, distance calculation, time formatting.
 * @license GPL-3.0-only
 */

import type { SavedPlan, Waypoint } from "@/lib/types";
import { haversineDistance } from "@/lib/geo/distance";

/** Filter plans by search query (matches name). */
export function filterPlans(plans: SavedPlan[], query: string): SavedPlan[] {
  if (!query.trim()) return plans;
  const q = query.toLowerCase();
  return plans.filter((p) => p.name.toLowerCase().includes(q));
}

/** Sort plans by the given field and direction. */
export function sortPlans(
  plans: SavedPlan[],
  sortBy: "name" | "date" | "waypoints",
  direction: "asc" | "desc"
): SavedPlan[] {
  const sorted = [...plans].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "date":
        return a.updatedAt - b.updatedAt;
      case "waypoints":
        return a.waypoints.length - b.waypoints.length;
    }
  });
  return direction === "desc" ? sorted.reverse() : sorted;
}

/**
 * Total path length (meters) over the waypoints that carry a position, using
 * Haversine. Items with no coordinates (a downloaded RTL, a TAKEOFF saved
 * without a position) sit at (0, 0) and are skipped, so they never add a leg
 * to the null island.
 */
export function totalDistance(waypoints: Waypoint[]): number {
  let dist = 0;
  let prev: Waypoint | null = null;
  for (const wp of waypoints) {
    if (wp.lat === 0 && wp.lon === 0) continue;
    if (prev) dist += haversineDistance(prev.lat, prev.lon, wp.lat, wp.lon);
    prev = wp;
  }
  return dist;
}

/** Format a relative time ago string. */
export function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

/** Format distance for display. */
export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters)}m`;
}
