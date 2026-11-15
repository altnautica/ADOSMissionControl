/**
 * A plan's place class (open, or a confined place) is saved with the plan:
 * the library and native file keep `settings.placeClass` (confined only;
 * open is the default and omitted), a `.plan` carries it as
 * `mission.placeClass` (the key the Android app writes), a share link keeps
 * it, and loading a plan restores it into the planner.
 * @license GPL-3.0-only
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const downloads: Blob[] = [];
vi.mock("@/lib/download", () => ({ downloadBlob: (blob: Blob) => void downloads.push(blob) }));

import { exportQGCPlan, parseQGCPlan } from "@/lib/mission-io-formats";
import { currentExportOptions } from "@/lib/mission-io";
import { buildMissionFile, decodePlan, encodePlan } from "@/lib/plan-share";
import { applyPlanToWorkspace, capturePlanExtras } from "@/lib/plan-workspace";
import { useMissionStore } from "@/stores/mission-store";
import type { SavedPlan, Waypoint } from "@/lib/types";

const WPS: Waypoint[] = [
  { id: "a", lat: 12.5, lon: 77.5, alt: 5, command: "WAYPOINT" },
  { id: "b", lat: 12.5001, lon: 77.5001, alt: 5, command: "WAYPOINT" },
];

afterEach(() => {
  downloads.length = 0;
  useMissionStore.setState({ placeClass: "open", plannedHome: null, vehicleProfile: null, transitAltM: null });
});

describe("plan place class", () => {
  it("saves confined with the plan and omits open", () => {
    useMissionStore.getState().setPlaceClass("confined");
    expect(capturePlanExtras().settings).toEqual({ placeClass: "confined" });
    useMissionStore.getState().setPlaceClass("open");
    expect(capturePlanExtras().settings).toBeUndefined();
  });

  it("loading a saved plan restores its class, and a plan without one is open", () => {
    const plan: SavedPlan = {
      id: "p1",
      name: "Drift 4",
      folderId: null,
      waypoints: WPS,
      metadata: {},
      frame: "relative",
      settings: { placeClass: "confined" },
      createdAt: 1,
      updatedAt: 1,
    };
    applyPlanToWorkspace(plan);
    expect(useMissionStore.getState().placeClass).toBe("confined");
    applyPlanToWorkspace({ ...plan, id: "p2", settings: undefined });
    expect(useMissionStore.getState().placeClass).toBe("open");
  });

  it("writes and reads a .plan's mission.placeClass", async () => {
    useMissionStore.getState().setPlaceClass("confined");
    exportQGCPlan(WPS, "drift", undefined, currentExportOptions());
    const text = await downloads[0].text();
    expect(JSON.parse(text).mission.placeClass).toBe("confined");
    expect(parseQGCPlan(text).settings?.placeClass).toBe("confined");

    useMissionStore.getState().setPlaceClass("open");
    exportQGCPlan(WPS, "open", undefined, currentExportOptions());
    const open = await downloads[1].text();
    expect("placeClass" in JSON.parse(open).mission).toBe(false);
    expect(parseQGCPlan(open).settings?.placeClass).toBeUndefined();
  });

  it("a share link keeps the class and refuses an unknown one", () => {
    const meta = { name: "Drift 4", createdAt: 1, updatedAt: 1 };
    const file = buildMissionFile(WPS, meta, { settings: { placeClass: "confined" } });
    expect(decodePlan(encodePlan(file))?.settings?.placeClass).toBe("confined");
    const bad = { ...file, settings: { placeClass: "cave" } };
    expect(decodePlan(encodePlan(bad as never))).toBeNull();
  });
});
