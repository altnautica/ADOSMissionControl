/**
 * Opening a demo drone's downloaded mission frames it on the planner map, as
 * the real download does.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { openDemoDroneMissionPlan } from "@/mock/engine-mission";
import { usePlannerStore } from "@/stores/planner-store";

describe("demo drone mission plan", () => {
  it("requests a map fit when it opens", () => {
    usePlannerStore.getState().clearFitRequest();
    expect(usePlannerStore.getState().fitRequestTs).toBe(0);

    openDemoDroneMissionPlan("alpha-1");

    expect(usePlannerStore.getState().fitRequestTs).toBeGreaterThan(0);
  });
});
