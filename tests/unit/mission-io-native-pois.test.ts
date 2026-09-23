/**
 * The native `.altmission` file carries the whole plan: points of interest
 * written on export come back on import.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: async (k: string) => store.get(k),
    set: async (k: string, v: unknown) => {
      store.set(k, v);
    },
    del: async (k: string) => {
      store.delete(k);
    },
  };
});

import { downloadMissionFile, importMissionFile } from "@/lib/mission-io";
import type { PointOfInterest } from "@/stores/plan-poi-store";

describe("native mission file", () => {
  it("round-trips plan POIs through export and import", async () => {
    const pois = [{ id: "poi_1", lat: 12.5, lon: 77.5, name: "Tower" }] as unknown as PointOfInterest[];
    let written: Blob | null = null;
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
      written = b as Blob;
      return "blob:mission";
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    downloadMissionFile([], { name: "plan", createdAt: 1, updatedAt: 1 }, { pois });
    create.mockRestore();
    revoke.mockRestore();

    expect(written).not.toBeNull();
    const text = await (written as unknown as Blob).text();
    const imported = await importMissionFile(new File([text], "plan.altmission"));
    expect(imported.pois).toEqual(pois);
  });
});
