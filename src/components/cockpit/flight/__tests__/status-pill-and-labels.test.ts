/**
 * @module cockpit/flight/status-pill-and-labels.test
 * @description The status pill's face (text, severity, flash until
 * acknowledged) and the controller drawing's leader labels (no two labels on
 * one line, none on the artwork) for both controller drawings.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import ds4Hotspots from "@/lib/cockpit/spec/ds4-hotspots.json";
import genericHotspots from "@/lib/cockpit/spec/gamepad-generic-hotspots.json";
import { layoutLeaderLabels, type LeaderInput } from "@/components/config/leader-labels";
import { pillSummary, type PillAlert } from "../StatusPill";

const warn: PillAlert = { key: "a", severity: "warning", text: "GPS: no 3D fix", source: "nav_source" };
const crit: PillAlert = { key: "b", severity: "critical", text: "Battery critical", source: "battery" };

describe("status pill", () => {
  it("reads All systems OK with no alert and never flashes", () => {
    expect(pillSummary([], new Set())).toEqual({ severity: "ok", text: "All systems OK", count: 0, flashing: false });
  });

  it("shows the one alert's own text", () => {
    expect(pillSummary([warn], new Set()).text).toBe("GPS: no 3D fix");
  });

  it("counts several alerts and takes the worst severity", () => {
    const s = pillSummary([crit, warn], new Set());
    expect(s.text).toBe("2 warnings");
    expect(s.severity).toBe("critical");
  });

  it("flashes until every listed alert is acknowledged, and again for a new one", () => {
    expect(pillSummary([warn], new Set()).flashing).toBe(true);
    expect(pillSummary([warn], new Set(["a"])).flashing).toBe(false);
    expect(pillSummary([warn, crit], new Set(["a"])).flashing).toBe(true);
  });
});

function inputs(table: { hotspots: Record<string, { label_anchor: number[]; label_side: string }> }): LeaderInput[] {
  return Object.entries(table.hotspots).map(([id, h]) => ({
    id,
    anchor: [h.label_anchor[0], h.label_anchor[1]] as const,
    side: h.label_side as LeaderInput["side"],
  }));
}

describe("controller leader labels", () => {
  for (const [name, table] of [["ds4", ds4Hotspots], ["generic", genericHotspots]] as const) {
    it(`keeps every ${name} label in a gutter, one per line`, () => {
      const art = [0, 0, 1000, 640] as const;
      const pitch = 36;
      const out = layoutLeaderLabels(inputs(table), { art, pitch, gap: 28, gutter: 280 });
      expect(out.labels).toHaveLength(Object.keys(table.hotspots).length);
      for (const side of ["left", "right"] as const) {
        const ys = out.labels.filter((l) => l.side === side).map((l) => l.y).sort((a, b) => a - b);
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(pitch);
      }
      for (const l of out.labels) {
        // Outside the artwork: left labels end before it, right labels start after it.
        if (l.side === "left") expect(l.x).toBeLessThan(art[0]);
        else expect(l.x).toBeGreaterThan(art[0] + art[2]);
        expect(l.y).toBeGreaterThanOrEqual(out.viewBox[1]);
        expect(l.y).toBeLessThanOrEqual(out.viewBox[1] + out.viewBox[3]);
      }
    });
  }
});
