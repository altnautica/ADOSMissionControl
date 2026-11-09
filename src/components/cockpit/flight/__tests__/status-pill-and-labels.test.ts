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
import { pilotAlerts, pillSummary, statusTextAlerts, type PillAlert } from "../StatusPill";
import { PILOT_STALE_MS } from "@/stores/nav-stream-store";
import type { PilotState } from "@/lib/hud/cockpit-frames";

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

describe("status pill: the pilot's FC status text", () => {
  const opts = { prearmLabel: (r: string) => `PREARM: ${r}`, disarmed: true };
  const ring = [
    { severity: 2, text: "Crash: Disarming", ageMs: 100 },
    { severity: 2, text: "PreArm: Compass not calibrated", ageMs: 1200 },
    { severity: 2, text: "PreArm: Compass not calibrated", ageMs: 9000 },
  ];

  it("lists each line once, critical at severity 2 or worse", () => {
    expect(statusTextAlerts(ring, new Set(), opts)[0]).toEqual({
      key: "fc:Crash: Disarming",
      severity: "critical",
      text: "Crash: Disarming",
      source: "fc_status_text",
    });
  });

  it("lists a PreArm line once, as the pre-arm item, as a warning", () => {
    const out = statusTextAlerts(ring, new Set(), opts);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      key: "alert:prearm:Compass not calibrated",
      severity: "warning",
      text: "PREARM: Compass not calibrated",
      source: "fc_prearm",
    });
  });

  it("does not repeat the cockpit's own pre-arm alert, and drops PreArm lines once armed", () => {
    const listed = new Set(["alert:prearm:Compass not calibrated"]);
    expect(statusTextAlerts(ring, listed, opts).map((a) => a.text)).toEqual(["Crash: Disarming"]);
    expect(statusTextAlerts(ring, new Set(), { ...opts, disarmed: false }).map((a) => a.text)).toEqual([
      "Crash: Disarming",
    ]);
  });

  it("skips a line another source already lists", () => {
    expect(statusTextAlerts(ring, new Set(["Crash: Disarming"]), opts).map((a) => a.text)).toEqual([
      "PREARM: Compass not calibrated",
    ]);
    expect(statusTextAlerts(undefined, new Set(), opts)).toEqual([]);
  });
});

describe("status pill: pilot freshness", () => {
  const opts = { prearmLabel: (r: string) => `PREARM: ${r}`, disarmed: true, notAnswering: "ADOS Pilot not answering" };
  const pilot = {
    readiness: [{ id: "gps", ok: false, severity: "warn", msg: "GPS not ready" }],
    statustext: [{ severity: 4, text: "EKF variance", ageMs: 0 }],
  } as unknown as PilotState;

  it("lists readiness and FC text while the pilot state is fresh", () => {
    expect(pilotAlerts(pilot, 1000, 1000 + PILOT_STALE_MS, [], opts).map((a) => a.text)).toEqual([
      "GPS not ready",
      "EKF variance",
    ]);
  });

  it("ages them out and warns that the pilot is not answering, never OK", () => {
    const out = pilotAlerts(pilot, 1000, 1001 + PILOT_STALE_MS, [], opts);
    expect(out.map((a) => a.text)).toEqual(["ADOS Pilot not answering"]);
    expect(pillSummary(out, new Set()).severity).toBe("warning");
    const clean = { readiness: [], statustext: [] } as unknown as PilotState;
    expect(pillSummary(pilotAlerts(clean, 0, 10_000, [], opts), new Set()).text).toBe("ADOS Pilot not answering");
  });

  it("adds nothing when no pilot state was ever received", () => {
    expect(pilotAlerts(null, null, 10_000, [], opts)).toEqual([]);
  });
});

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
