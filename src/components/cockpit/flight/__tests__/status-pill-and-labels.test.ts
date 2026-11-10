/**
 * @module cockpit/flight/status-pill-and-labels.test
 * @description The status pill's face (text, severity, flash until
 * acknowledged) and the controller drawing's leader labels (no two labels on
 * one line, none on the artwork) for both controller drawings.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import ds4Hotspots from "@/lib/cockpit-spec/ds4-hotspots.json";
import genericHotspots from "@/lib/cockpit-spec/gamepad-generic-hotspots.json";
import { layoutLeaderLabels, type LeaderInput } from "@/components/config/leader-labels";
import { pillAlertsFor, type PillAlert, type PillSources } from "../StatusPill";
import { pillSummary } from "@/lib/hud/status-pill";
import { specString } from "@/lib/cockpit/spec-strings";
import type { PilotState } from "@/lib/hud/cockpit-frames";

const warn: PillAlert = { id: "a", severity: "warning", text: "GPS: no 3D fix", source: "nav_source" };
const crit: PillAlert = { id: "b", severity: "critical", text: "Battery critical", source: "battery" };

describe("status pill", () => {
  it("reads All systems OK with no alert and never flashes", () => {
    expect(pillSummary([], new Set())).toMatchObject({ severity: "ok", text: "All systems OK", count: 0, flashing: false });
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

const ring = [
  { severity: 2, text: "Crash: Disarming", ageMs: 100 },
  { severity: 2, text: "PreArm: Compass not calibrated", ageMs: 1200 },
  { severity: 2, text: "PreArm: Compass not calibrated", ageMs: 9000 },
];
const flying = {
  readiness: [{ id: "gps", ok: false, severity: "warn", msg: "GPS not ready" }],
  statustext: [{ severity: 4, text: "EKF variance", ageMs: 0 }],
  holdReason: null,
  armed: true,
  landed: false,
} as unknown as PilotState;

function sources(over: Partial<PillSources>): PillSources {
  return {
    surface: [],
    pilot: flying,
    pilotAgeMs: 100,
    agentReachable: true,
    disarmed: false,
    preflight: null,
    storagePct: null,
    ...over,
  };
}
const texts = (s: Partial<PillSources>) => pillAlertsFor(sources(s)).map((a) => a.text);

describe("status pill: the pilot's FC status text", () => {
  const onGround = { ...flying, readiness: [], statustext: ring } as unknown as PilotState;

  it("lists each line once, critical at severity 2 or worse, the PreArm line as the pre-arm item", () => {
    const out = pillAlertsFor(sources({ pilot: onGround, disarmed: true }));
    expect(out.map((a) => [a.source, a.severity, a.text])).toEqual([
      ["fc_status_text", "critical", "Crash: Disarming"],
      ["fc_prearm", "warning", specString("flow.preflight.fc_prearm.failing", { text: "Compass not calibrated" })],
    ]);
  });

  it("does not repeat the surface's own pre-arm alert or status line, and drops PreArm lines once armed", () => {
    const own: PillAlert = { id: "alert:prearm:x", severity: "warning", text: "PreArm", source: "fc_prearm" };
    expect(texts({ pilot: onGround, disarmed: true, surface: [own] })).toEqual(["Crash: Disarming", "PreArm"]);
    expect(texts({ pilot: onGround })).toEqual(["Crash: Disarming"]);
    const line: PillAlert = { id: "alert:statusText:", severity: "critical", text: "Crash: Disarming", source: "fc_status_text" };
    expect(texts({ pilot: onGround, surface: [line] })).toEqual(["Crash: Disarming"]);
  });
});

describe("status pill: pilot freshness, agent and controller", () => {
  it("lists readiness and FC text while the pilot state is fresh", () => {
    expect(texts({ pilotAgeMs: 1999 })).toEqual(["GPS not ready", "EKF variance"]);
  });

  it("drops them once stale and warns that the pilot is not answering, never OK", () => {
    expect(texts({ pilotAgeMs: 2000 })).toEqual([specString("alert.pilot_not_answering")]);
    expect(texts({ pilot: null, pilotAgeMs: null })).toEqual([specString("alert.pilot_not_answering")]);
  });

  it("adds no pilot item when no agent is paired", () => {
    expect(texts({ pilot: null, pilotAgeMs: undefined, agentReachable: undefined })).toEqual([]);
  });

  it("raises an unreachable agent as critical", () => {
    const out = pillAlertsFor(sources({ agentReachable: false }));
    expect(out[0]).toMatchObject({ id: "agent_unreachable", severity: "critical", source: "link" });
  });

  it("raises a controller lost in the air, from a fresh pilot only", () => {
    const lost = { ...flying, readiness: [], statustext: [], holdReason: "controller-lost" } as unknown as PilotState;
    expect(texts({ pilot: lost })).toEqual([specString("alert.controller_lost")]);
    expect(texts({ pilot: lost, pilotAgeMs: 2500 })).toEqual([specString("alert.pilot_not_answering")]);
  });
});

describe("status pill: pre-flight checks", () => {
  const clean = { ...flying, readiness: [], statustext: [], armed: false, landed: true } as unknown as PilotState;
  const preflight = [
    { id: "pilot:gps", label: "GPS not ready", state: "fail" as const },
    { id: "battery", label: "Battery", state: "fail" as const },
    { id: "nav_source", label: "Navigation source", state: "warn" as const },
  ];

  it("lists a failing check on the ground, so the pill never reads OK while one fails", () => {
    expect(texts({ pilot: clean, disarmed: true, preflight })).toEqual([
      specString("alert.preflight_failing", { item: "Battery" }),
    ]);
  });

  it("skips a check whose source the pill already lists, and lists none in the air", () => {
    expect(texts({ pilot: clean, disarmed: true, preflight, surface: [crit] })).toEqual(["Battery critical"]);
    expect(texts({ pilot: clean, disarmed: false, preflight })).toEqual([]);
  });

  it("reads storage as percent used from the spec", () => {
    expect(texts({ pilot: clean, storagePct: 98 })).toEqual([specString("cockpit.status.storage_used", { pct: 98 })]);
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
