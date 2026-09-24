/**
 * @description The flight HUD with no FC attached.
 *
 * The defect: the HUD drew a hardcoded four-bar signal meter and a perfectly
 * level artificial horizon on a vehicle with no flight controller and no radio
 * — a full-strength link and a level aircraft, both invented. These pin the
 * honest state: no bars, no horizon, and the no-data glyph where a reading
 * would be.
 *
 * Asserted against the canvas operations the HUD actually issues, because the
 * fabrication was in the drawing call, not in a value a component rendered.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneStore } from "@/stores/drone-store";
import { readHudFrame, signalBarsFromRssi } from "@/lib/hud-readings";
import { HUD_INK, NO_DATA_GLYPH } from "@/lib/hud-draw";
import { drawSignalBars, drawGpsAndMode } from "@/lib/hud-draw-status";
import { drawSkyGround, drawRollArc, drawPitchLadder } from "@/lib/hud-draw-attitude";

interface FillCall {
  style: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A canvas 2D context recorder. Only the operations these assertions read are
 * captured; everything else is a no-op so a draw function runs to completion.
 */
function recordingCtx() {
  const fills: FillCall[] = [];
  const texts: { text: string; style: string }[] = [];
  let strokes = 0;
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    font: "",
    textAlign: "center" as CanvasTextAlign,
    textBaseline: "middle" as CanvasTextBaseline,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    fillRect(x: number, y: number, w: number, h: number) {
      fills.push({ style: String(this.fillStyle), x, y, w, h });
    },
    fillText(text: string) {
      texts.push({ text, style: String(this.fillStyle) });
    },
    createLinearGradient: () => ({ addColorStop: () => {} }),
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    rect: () => {},
    clip: () => {},
    fill: () => {},
    stroke() {
      strokes += 1;
    },
    strokeRect: () => {},
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    fills,
    texts,
    strokeCount: () => strokes,
  };
}

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  useTelemetryStore.getState().clear();
  useDroneStore.setState({
    armState: "disarmed",
    flightMode: "STABILIZE",
    lastHeartbeat: 0,
    connectionState: "disconnected",
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("HUD readings with no FC attached", () => {
  it("knows nothing: no attitude, no signal, no mode", () => {
    const hud = readHudFrame();
    expect(hud.pitch).toBeNull();
    expect(hud.roll).toBeNull();
    expect(hud.signalBars).toBeNull();
    expect(hud.mode).toBeNull();
    expect(hud.armed).toBeNull();
    expect(hud.batteryPct).toBeNull();
    expect(hud.satellites).toBeNull();
  });

  it("draws no lit signal bars and shows the no-data glyph", () => {
    const rec = recordingCtx();
    drawSignalBars(rec.ctx, 100, 100, readHudFrame().signalBars);

    // Four bar rectangles, and not one of them in the live ink.
    expect(rec.fills).toHaveLength(4);
    expect(rec.fills.filter((f) => f.style === HUD_INK)).toHaveLength(0);
    expect(rec.texts.map((t) => t.text)).toContain(NO_DATA_GLYPH);
  });

  it("draws no horizon: a flat field labelled NO ATTITUDE, never a level line", () => {
    const rec = recordingCtx();
    const hud = readHudFrame();
    drawSkyGround(rec.ctx, 400, 300, hud.pitch, hud.roll);

    // The horizon line is a stroke; the level-looking horizon was exactly that
    // stroke drawn through the middle of a sky/ground gradient.
    expect(rec.strokeCount()).toBe(0);
    expect(rec.texts.map((t) => t.text)).toEqual(["NO ATTITUDE"]);
  });

  it("draws no pitch ladder and no roll pointer", () => {
    const ladder = recordingCtx();
    const arc = recordingCtx();
    const hud = readHudFrame();

    drawPitchLadder(ladder.ctx, 200, 150, hud.pitch, hud.roll, 300);
    drawRollArc(arc.ctx, 200, 150, hud.roll, 300);

    expect(ladder.strokeCount()).toBe(0);
    expect(ladder.texts.map((t) => t.text)).toEqual(["NO ATTITUDE"]);
    // The roll arc is pure geometry: with no angle, nothing is drawn at all.
    expect(arc.strokeCount()).toBe(0);
    expect(arc.fills).toHaveLength(0);
  });

  it("shows the no-data glyph for the flight mode rather than the last mode heard", () => {
    // A mode arrives, then the link goes silent past the heartbeat window.
    useDroneStore.setState({ flightMode: "GUIDED", lastHeartbeat: NOW });
    expect(readHudFrame().mode).toBe("GUIDED");

    vi.setSystemTime(NOW + 4000);
    expect(readHudFrame().mode).toBeNull();

    const rec = recordingCtx();
    drawGpsAndMode(rec.ctx, 16, 200, null, readHudFrame().mode);
    expect(rec.texts.map((t) => t.text)).not.toContain("GUIDED");
    expect(rec.texts.filter((t) => t.text === NO_DATA_GLYPH)).toHaveLength(1);
  });
});

describe("HUD readings with a live FC", () => {
  it("draws the measured attitude and the measured bar count", () => {
    useTelemetryStore.getState().pushAttitude({
      timestamp: NOW,
      roll: 12,
      pitch: -4,
      yaw: 30,
      rollSpeed: 0,
      pitchSpeed: 0,
      yawSpeed: 0,
    });
    useTelemetryStore.getState().pushRadio({
      timestamp: NOW,
      rssi: 190,
      remrssi: 180,
      txbuf: 0,
      noise: 20,
      remnoise: 20,
      rxerrors: 0,
      fixed: 0,
      sourceSystemId: 51,
    });

    const hud = readHudFrame();
    expect(hud.pitch).toBe(-4);
    expect(hud.roll).toBe(12);
    expect(hud.signalBars).toBe(3);

    const rec = recordingCtx();
    drawSignalBars(rec.ctx, 100, 100, hud.signalBars);
    expect(rec.fills.filter((f) => f.style === HUD_INK)).toHaveLength(3);
    expect(rec.texts).toHaveLength(0);
  });

  it("distinguishes a measured dead link from an unmeasured one", () => {
    // 0 bars is a reading — the radio is being heard and reports nothing.
    expect(
      signalBarsFromRssi({
        timestamp: NOW,
        rssi: 0,
        remrssi: 0,
        txbuf: 0,
        noise: 0,
        remnoise: 0,
        rxerrors: 0,
        fixed: 0,
        sourceSystemId: 51,
      }),
    ).toBe(0);
    // A stale sample is not a reading at all.
    expect(
      signalBarsFromRssi({
        timestamp: NOW - 60_000,
        rssi: 250,
        remrssi: 250,
        txbuf: 0,
        noise: 0,
        remnoise: 0,
        rxerrors: 0,
        fixed: 0,
        sourceSystemId: 51,
      }),
    ).toBeNull();
    expect(signalBarsFromRssi(undefined)).toBeNull();
  });

  it("reads the unknown rssi value and an unknown radio scale as no data", () => {
    const sik = {
      timestamp: NOW,
      rssi: 200,
      remrssi: 0,
      txbuf: 0,
      noise: 0,
      remnoise: 0,
      rxerrors: 0,
      fixed: 0,
      sourceSystemId: 51,
    };
    expect(signalBarsFromRssi(sik)).toBe(3);
    // 255 is the field's "invalid / unknown" value, not full signal.
    expect(signalBarsFromRssi({ ...sik, rssi: 255 })).toBeNull();
    // A radio whose byte carries signed dBm (-128 with nothing received packs
    // to 128) must not be read on the SiK scale.
    expect(signalBarsFromRssi({ ...sik, rssi: 128, sourceSystemId: 3 })).toBeNull();
  });

  it("reads altitude as height above home, never MSL", () => {
    // A site 300 m above sea level, the aircraft 20 m above home.
    useTelemetryStore.getState().pushPosition({
      timestamp: NOW,
      lat: 12.97,
      lon: 77.59,
      alt: 320,
      relativeAlt: 20,
      heading: 90,
      groundSpeed: 4,
      airSpeed: 4,
      climbRate: 0,
    });
    useTelemetryStore.getState().pushVfr({
      timestamp: NOW,
      airspeed: 4,
      groundspeed: 4,
      heading: 90,
      throttle: 40,
      alt: 320,
      climb: 0,
    });
    expect(readHudFrame().alt).toBe(20);

    // Position goes stale while VFR_HUD keeps arriving: its MSL altitude is
    // not a substitute for height above home.
    vi.setSystemTime(NOW + 10_000);
    useTelemetryStore.getState().pushVfr({
      timestamp: NOW + 10_000,
      airspeed: 4,
      groundspeed: 4,
      heading: 90,
      throttle: 40,
      alt: 320,
      climb: 0,
    });
    expect(readHudFrame().alt).toBeNull();
  });
});
