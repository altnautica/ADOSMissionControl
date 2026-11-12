/**
 * @license GPL-3.0-only
 *
 * A plan file with a fence or rally points but no waypoints imports; only a
 * file with nothing to plan with is refused.
 */

import { describe, it, expect } from "vitest";
import { importMissionFile } from "@/lib/mission-io";
import { importedPlanHasContent } from "@/components/library/import-content";

function planFile(body: object): File {
  return new File([JSON.stringify(body)], "fenceonly.plan", { type: "application/json" });
}

const base = {
  fileType: "Plan",
  version: 1,
  groundStation: "test",
  mission: { version: 2, firmwareType: 3, vehicleType: 2, cruiseSpeed: 15, hoverSpeed: 5, items: [], plannedHomePosition: [12.97, 77.59, 900] },
  geoFence: { version: 2, polygons: [], circles: [] },
  rallyPoints: { version: 2, points: [] },
};

describe("importedPlanHasContent", () => {
  it("accepts a rally-only .plan file", async () => {
    const result = await importMissionFile(
      planFile({ ...base, rallyPoints: { version: 2, points: [[12.971, 77.591, 30]] } }),
    );
    expect(result.waypoints).toHaveLength(0);
    expect(importedPlanHasContent(result)).toBe(true);
  });

  it("accepts a fence-only .plan file", async () => {
    const result = await importMissionFile(
      planFile({
        ...base,
        geoFence: {
          version: 2,
          circles: [],
          polygons: [{ inclusion: true, version: 1, polygon: [[12.97, 77.59], [12.98, 77.59], [12.98, 77.6]] }],
        },
      }),
    );
    expect(importedPlanHasContent(result)).toBe(true);
  });

  it("refuses a file with nothing in it", async () => {
    const result = await importMissionFile(planFile(base));
    expect(importedPlanHasContent(result)).toBe(false);
  });
});
