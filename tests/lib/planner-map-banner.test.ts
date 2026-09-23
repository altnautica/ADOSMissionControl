/**
 * Unit tests for the pure mode -> hint-banner descriptor mapping used by the
 * mission planner map. The mapping must produce one consistent banner for every
 * interaction mode (select / waypoint / datum / rally / draw) so the map renders
 * a single mode-driven hint surface.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import type { PlannerMode } from "@/lib/planner-mode";

// The helpers module builds leaflet icons; the descriptor under test is pure,
// so stub leaflet so the import resolves in the headless test environment.
vi.mock("leaflet", async () => {
  const mock = await import("../__mocks__/leaflet");
  return { default: mock.default };
});

import { mapBannerDescriptor } from "@/components/planner/planner-map-helpers";

describe("mapBannerDescriptor", () => {
  it("gives select mode a subdued always-on add-waypoint hint", () => {
    const d = mapBannerDescriptor({ kind: "select" });
    expect(d).not.toBeNull();
    expect(d?.tone).toBe("subdued");
    expect(d?.message).toMatch(/waypoint/i);
  });

  it("gives every waypoint placement tool a non-empty accent hint", () => {
    const tools: Array<PlannerMode & { kind: "waypoint" }> = [
      { kind: "waypoint", tool: "waypoint" },
      { kind: "waypoint", tool: "takeoff" },
      { kind: "waypoint", tool: "land" },
      { kind: "waypoint", tool: "loiter" },
      { kind: "waypoint", tool: "roi" },
    ];
    for (const mode of tools) {
      const d = mapBannerDescriptor(mode);
      expect(d, mode.tool).not.toBeNull();
      expect(d?.tone, mode.tool).toBe("accent");
      expect((d?.message ?? "").length, mode.tool).toBeGreaterThan(0);
    }
  });

  it("gives the rally and datum placement modes an accent hint", () => {
    const rally = mapBannerDescriptor({ kind: "rally" });
    expect(rally?.tone).toBe("accent");
    expect(rally?.message).toMatch(/rally/i);

    const datum = mapBannerDescriptor({ kind: "datum", pattern: null });
    expect(datum?.tone).toBe("accent");
    expect(datum?.message).toMatch(/datum/i);
  });

  it("tailors the datum hint to the armed SAR pattern", () => {
    // No pattern armed → prompt to pick one; the radial patterns set a datum
    // point; a parallel track sets a start point.
    const noPattern = mapBannerDescriptor({ kind: "datum", pattern: null });
    expect(noPattern?.message).toMatch(/select a search pattern/i);
    const radial = mapBannerDescriptor({ kind: "datum", pattern: "expandingSquare" });
    expect(radial?.message).toMatch(/datum point/i);
    const track = mapBannerDescriptor({ kind: "datum", pattern: "parallelTrack" });
    expect(track?.message).toMatch(/start point/i);
    expect(radial).not.toEqual(track);
  });

  it("gives each draw shape its own accent hint", () => {
    const shapes: DrawShapeMode[] = [
      { kind: "draw", shape: "polygon", drawingFor: "free" },
      { kind: "draw", shape: "circle", drawingFor: "free" },
      { kind: "draw", shape: "measure", drawingFor: "free" },
    ];
    const messages = new Set<string>();
    for (const mode of shapes) {
      const d = mapBannerDescriptor(mode);
      expect(d?.tone, mode.shape).toBe("accent");
      expect((d?.message ?? "").length, mode.shape).toBeGreaterThan(0);
      messages.add(d?.message ?? "");
    }
    // The three draw shapes each get a distinct instruction.
    expect(messages.size).toBe(3);
  });
});

type DrawShapeMode = PlannerMode & { kind: "draw" };
