/**
 * Plan library card distance and sort order.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import { sortPlans, totalDistance } from "@/lib/plan-library";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import type { SavedPlan, Waypoint } from "@/lib/types";

function wp(id: string, lat: number, lon: number, command: Waypoint["command"] = "WAYPOINT"): Waypoint {
  return { id, lat, lon, alt: 30, command } as Waypoint;
}

describe("totalDistance", () => {
  it("skips items with no coordinates instead of adding legs to (0, 0)", () => {
    const route = [wp("a", 12.97, 77.59), wp("b", 12.98, 77.59)];
    const leg = totalDistance(route);
    expect(leg).toBeGreaterThan(1000);
    expect(leg).toBeLessThan(1200);
    // A downloaded mission with a leading TAKEOFF and a trailing RTL that carry
    // no position measures the same flown route.
    const downloaded = [wp("t", 0, 0, "TAKEOFF"), ...route, wp("r", 0, 0, "RTL")];
    expect(totalDistance(downloaded)).toBeCloseTo(leg, 6);
  });
});

describe("plan sort order", () => {
  const plan = (name: string, updatedAt: number): SavedPlan =>
    ({ id: name, name, updatedAt, createdAt: updatedAt, waypoints: [] }) as unknown as SavedPlan;
  const plans = [plan("bravo", 2), plan("alpha", 1), plan("charlie", 3)];

  beforeEach(() => {
    usePlanLibraryStore.setState({ sortBy: "date", sortDirection: "desc" });
  });

  it("lists names A to Z when Name is chosen, and the toggle reverses it", () => {
    usePlanLibraryStore.getState().setSortBy("name");
    let { sortBy, sortDirection } = usePlanLibraryStore.getState();
    expect(sortPlans(plans, sortBy, sortDirection).map((p) => p.name)).toEqual(["alpha", "bravo", "charlie"]);

    usePlanLibraryStore.getState().toggleSortDirection();
    ({ sortBy, sortDirection } = usePlanLibraryStore.getState());
    expect(sortPlans(plans, sortBy, sortDirection).map((p) => p.name)).toEqual(["charlie", "bravo", "alpha"]);
  });

  it("lists dates newest first when Date is chosen", () => {
    usePlanLibraryStore.getState().setSortBy("name");
    usePlanLibraryStore.getState().setSortBy("date");
    const { sortBy, sortDirection } = usePlanLibraryStore.getState();
    expect(sortPlans(plans, sortBy, sortDirection).map((p) => p.name)).toEqual(["charlie", "bravo", "alpha"]);
  });
});
