/**
 * @module hud/horizon-honesty.test
 * @description The artificial horizon must not invent an attitude.
 *
 * `pitchDeg` and `rollDeg` defaulted to 0, so with no attitude telemetry the
 * instrument drew a perfectly wings-level horizon. A pilot glancing at a
 * level ball believes the aircraft is level, which makes this the worst
 * fabrication class in the whole HUD: it is indistinguishable from a correct
 * reading. Absent attitude must raise a failure flag instead.
 *
 * @license GPL-3.0-only
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HorizonSvg } from "@/components/hud/HorizonSvg";
import { BottomBar } from "@/components/hud/BottomBar";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

describe("HorizonSvg", () => {
  afterEach(cleanup);

  it("draws the ball and ladder from a live attitude", () => {
    const { container } = render(<HorizonSvg pitchDeg={-8} rollDeg={22} />);
    expect(container.querySelector("[data-testid='horizon-attitude-flag']")).toBeNull();
    // The roll transform is the instrument actually responding to attitude.
    expect(container.innerHTML).toContain("rotate(-22 100 100)");
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toBe("Artificial horizon");
  });

  it("raises the ATT failure flag when attitude is absent", () => {
    const { container } = render(<HorizonSvg />);
    expect(container.querySelector("[data-testid='horizon-attitude-flag']")).not.toBeNull();

    // No sky, no ground, no ladder — nothing an operator could read as level.
    expect(container.innerHTML).not.toContain("#1e3a5f");
    expect(container.innerHTML).not.toContain("#5a3a1e");
    expect(container.innerHTML).not.toContain("rotate(0 100 100)");
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toContain("unavailable");
  });

  it("raises the flag for a null or non-finite attitude, not just a missing prop", () => {
    for (const props of [
      { pitchDeg: null, rollDeg: null },
      { pitchDeg: 4, rollDeg: null },
      { pitchDeg: Number.NaN, rollDeg: 0 },
      { pitchDeg: 0, rollDeg: Number.POSITIVE_INFINITY },
    ] as const) {
      const { container, unmount } = render(<HorizonSvg {...props} />);
      expect(
        container.querySelector("[data-testid='horizon-attitude-flag']"),
        JSON.stringify(props),
      ).not.toBeNull();
      unmount();
    }
  });

  it("draws a genuine wings-level reading, which must still look level", () => {
    // The fix must not blank a real zero: straight and level is a valid
    // attitude and has to render as one.
    const { container } = render(<HorizonSvg pitchDeg={0} rollDeg={0} />);
    expect(container.querySelector("[data-testid='horizon-attitude-flag']")).toBeNull();
    expect(container.innerHTML).toContain("#1e3a5f");
  });
});

describe("HUD kiosk bottom bar", () => {
  beforeEach(cleanup);
  afterEach(cleanup);

  function pushAttitude(ageMs: number) {
    const timestamp = Date.now() - ageMs;
    const s = useTelemetryStore.getState();
    s.pushAttitude({
      timestamp,
      roll: 15,
      pitch: -6,
      yaw: 90,
      rollSpeed: 0,
      pitchSpeed: 0,
      yawSpeed: 0,
    });
    s.pushVfr({
      timestamp,
      airspeed: 12,
      groundspeed: 11,
      heading: 90,
      throttle: 45,
      alt: 120,
      climb: 0.4,
    });
  }

  it("flies the instrument from fresh telemetry", () => {
    pushAttitude(0);
    const { container } = render(<BottomBar />);
    expect(container.querySelector("[data-testid='horizon-attitude-flag']")).toBeNull();
    expect(container.innerHTML).toContain("rotate(-15 100 100)");
    expect(container.textContent).toContain("120");
  });

  it("flags the instrument and blanks the tapes once telemetry goes stale", () => {
    pushAttitude(TELEMETRY_STALE_MS + 1_000);
    const { container } = render(<BottomBar />);

    // The sample is still in the ring; the kiosk must not present it.
    expect(useTelemetryStore.getState().attitude.latest()?.roll).toBe(15);
    expect(container.querySelector("[data-testid='horizon-attitude-flag']")).not.toBeNull();
    expect(container.innerHTML).not.toContain("rotate(-15 100 100)");
    expect(container.textContent).not.toContain("120");
  });
});
