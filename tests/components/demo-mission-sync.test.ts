import { describe, it, expect, afterEach } from "vitest";
import { demoStartPlan, seedDemoMissions } from "@/components/layout/DemoMissionSync";
import { DEMO_PLANS } from "@/mock/demo-missions";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useMissionStore } from "@/stores/mission-store";
import { useRallyStore } from "@/stores/rally-store";
import type { Waypoint } from "@/lib/types";

describe("demoStartPlan", () => {
  it("keeps the plan that was open before a reload", () => {
    const open = DEMO_PLANS[2];
    expect(demoStartPlan(open.id, DEMO_PLANS)).toBe(open);
  });

  it("opens the first demo mission when no plan was open", () => {
    expect(demoStartPlan(null, DEMO_PLANS)).toBe(DEMO_PLANS[0]);
  });

  it("opens the first demo mission when the open plan no longer exists", () => {
    expect(demoStartPlan("deleted-plan", DEMO_PLANS)).toBe(DEMO_PLANS[0]);
  });
});

describe("seedDemoMissions on a reload", () => {
  let teardown: (() => void) | null = null;
  afterEach(() => {
    teardown?.();
    teardown = null;
  });

  it("keeps the unsaved path and rally points of the plan that was open", () => {
    const open = DEMO_PLANS[2];
    // The persisted state a reload hydrates: the demo plans, the open plan, and
    // the live workspace holding edits made after the last save.
    const edited: Waypoint[] = [
      ...open.waypoints,
      { id: "added-after-save", lat: 45.981, lon: 7.661, alt: 60, command: "WAYPOINT" },
    ];
    const editedRally = [{ id: "moved-rally", lat: 45.979, lon: 7.658, alt: 45 }];
    usePlanLibraryStore.setState({ plans: [...DEMO_PLANS], activePlanId: open.id });
    useMissionStore.getState().setWaypoints(edited);
    useRallyStore.setState({ points: editedRally });

    teardown = seedDemoMissions();

    expect(usePlanLibraryStore.getState().activePlanId).toBe(open.id);
    expect(useMissionStore.getState().waypoints.map((w) => w.id)).toEqual(edited.map((w) => w.id));
    expect(useRallyStore.getState().points).toEqual(editedRally);
  });

  it("opens a demo mission from its saved copy when nothing was open", () => {
    usePlanLibraryStore.setState({ plans: [], activePlanId: null });
    useMissionStore.getState().setWaypoints([]);

    teardown = seedDemoMissions();

    const opened = DEMO_PLANS.find((p) => p.id === usePlanLibraryStore.getState().activePlanId);
    expect(opened).toBeDefined();
    expect(useMissionStore.getState().waypoints).toHaveLength(opened!.waypoints.length);
  });
});
