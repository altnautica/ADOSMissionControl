/**
 * @license GPL-3.0-only
 *
 * While the operator's sticks fly, the flight-state chip names the profile
 * with its horizontal limit, a stick input older than 100 ms, the obstacle
 * clearance coloured by the margin (warning when near, critical inside it),
 * and the vehicle's horizontal and vertical speed when the bottom row has no
 * room for them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";

import { FlightGridContext } from "@/components/cockpit/flight/flight-context";
import { flightGrid, type FlightGrid } from "@/components/cockpit/flight/flight-grid";
import { specString } from "@/lib/cockpit/spec-strings";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { demoPilotWire } from "@/mock/mock-pilot";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import type { VfrData } from "@/lib/types/telemetry";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import { FlightStateChip } from "../FlightStateChip";

const DRONE = "chip-sticks";
const WIDE = flightGrid({ width: 1280, height: 720, widthClass: "expanded" });
/** The same grid with a bottom row that only has room for distance and height. */
const NARROW_ROW: FlightGrid = { ...WIDE, zones: { ...WIDE.zones, bottom_row: { ...WIDE.zones.bottom_row!, w: 120 } } };

const LIMITS = { profile: "normal", v_h_mps: 7, v_up_mps: 2.5, v_down_mps: 1.5, yaw_dps: 90, margin_m: 1.5, stop_m: 13 };

function pin(over: Record<string, unknown> = {}) {
  const raw = demoPilotWire({ owner: "pilot", profile: "normal", profile_limits: LIMITS, ...over });
  const pilot = parsePilotState(raw);
  if (!pilot) throw new Error("demo pilot wire did not parse");
  useNavStreamStore.getState().setPilot(DRONE, pilot, Date.now(), raw);
}

/** Render the chip; its state text and its secondary parts. */
function chip(grid: FlightGrid = WIDE, compact = false) {
  cleanup();
  renderWithIntl(
    <FlightGridContext.Provider value={grid}>
      <FlightStateChip droneId={DRONE} barWidth={4000} compact={compact} />
    </FlightGridContext.Provider>,
  );
  const text = screen.getByTestId("flight-state-chip-text").textContent ?? "";
  const parts = screen
    .queryAllByTestId("flight-state-chip-part")
    .map((p) => ({ text: (p.textContent ?? "").replace(/^ · /, ""), severity: p.getAttribute("data-severity") }));
  return { text, parts };
}

afterEach(() => {
  cleanup();
  useNavStreamStore.getState().clear(DRONE);
  useTelemetryStore.getState().clear();
});

describe("flight-state chip under the sticks", () => {
  it("names the profile with its horizontal limit", () => {
    pin();
    const { text } = chip();
    expect(text).toContain("Normal");
    expect(text).toContain(specString("chip.stick.limit", { v: "7" }));
  });

  it("shows a stick input older than 100 ms in the warning colour, and not a fresh one", () => {
    pin({ stick: { input_age_ms: 240, input_seq: 9 } });
    expect(chip().parts).toContainEqual({ text: specString("chip.stick.input_age", { ms: 240 }), severity: "warning" });
    pin({ stick: { input_age_ms: 40, input_seq: 10 } });
    expect(chip().parts.map((p) => p.text)).not.toContain(specString("chip.stick.input_age", { ms: 40 }));
  });

  it("colours the clearance by the margin: warning when near, critical inside it", () => {
    pin({ min_clearance_m: 2.4 });
    expect(chip().parts).toContainEqual({ text: specString("chip.stick.clearance", { m: "2.4" }), severity: "warning" });
    pin({ min_clearance_m: 1.2 });
    expect(chip().parts).toContainEqual({ text: specString("chip.stick.clearance", { m: "1.2" }), severity: "critical" });
    pin({ min_clearance_m: 5 });
    expect(chip().parts.map((p) => p.text)).not.toContain(specString("chip.stick.clearance", { m: "5.0" }));
  });

  it("adds horizontal and vertical speed only where the bottom row cannot show them", () => {
    pin();
    const vfr: VfrData = { timestamp: Date.now(), groundspeed: 4.2, alt: 10, climb: -0.5 };
    useTelemetryStore.getState().pushVfr(vfr);
    const narrow = chip(NARROW_ROW).parts.map((p) => p.text);
    expect(narrow.some((t) => /^H \+?4\.2 m\/s$/.test(t))).toBe(true);
    expect(narrow).toContain("V -0.5 m/s");
    const wide = chip(WIDE).parts.map((p) => p.text);
    expect(wide.some((t) => /^[HV] /.test(t))).toBe(false);
  });

  it("keeps the stick facts on the compact face and drops the rest", () => {
    pin({ stick: { input_age_ms: 240, input_seq: 11 }, min_clearance_m: 1.2, hold_reason: "pilot_hold" });
    const vfr: VfrData = { timestamp: Date.now(), groundspeed: 4.2, alt: 10, climb: -0.5 };
    useTelemetryStore.getState().pushVfr(vfr);
    const full = chip(NARROW_ROW).parts.map((p) => p.text);
    const compact = chip(NARROW_ROW, true).parts;
    const texts = compact.map((p) => p.text);
    expect(compact).toContainEqual({ text: specString("chip.stick.clearance", { m: "1.2" }), severity: "critical" });
    expect(compact).toContainEqual({ text: specString("chip.stick.input_age", { ms: 240 }), severity: "warning" });
    expect(texts.some((t) => /^H \+?4\.2 m\/s$/.test(t))).toBe(true);
    expect(texts).toContain("V -0.5 m/s");
    // Everything else stays on the full face only.
    expect(full.length).toBeGreaterThan(texts.length);
  });

  it("lets the compact and portrait cockpits show the parts the compact face keeps", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const hiding = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      ([, sel, body]) => /data-grid="(compact|portrait)"[^,]*\.fs-chip-sub/.test(sel) && /display:\s*none/.test(body),
    );
    expect(hiding.map(([, sel]) => sel.trim())).toEqual([]);
  });
});
