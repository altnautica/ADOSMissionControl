/**
 * @license GPL-3.0-only
 *
 * The controller's camera bindings: L2 / R2 drive the gimbal pitch rate on
 * the agent (full travel = the spec's 60 °/s, renewed inside the hold, one
 * zero on release), and the touchpad's designate reticle moves on the D-pad,
 * designates on Cross and cancels on Circle.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { GIMBAL_RATE_HOLD_MS, GimbalRateDriver, triggerPitchDps } from "../gimbal-rate";
import {
  RETICLE_STEP,
  reticleBox,
  reticleControl,
  setReticleSelect,
  toggleReticle,
  useDesignateReticle,
} from "../designate-reticle";

afterEach(() => {
  useDesignateReticle.setState({ open: false, x: 0.5, y: 0.5, onSelect: null });
});

describe("gimbal pitch rate from the triggers", () => {
  it("maps full R2 to +60 and full L2 to -60, ignoring the deadband", () => {
    expect(triggerPitchDps(0, 1, 60)).toBe(60);
    expect(triggerPitchDps(1, 0, 60)).toBe(-60);
    expect(triggerPitchDps(0.02, 0.03, 60)).toBe(0);
  });

  it("sends on change, renews within the hold and sends one zero on release", async () => {
    const send = vi.fn(async () => 200);
    const g = new GimbalRateDriver("drone-1", 60, send);
    g.tick(0, 1, 0);
    g.tick(0, 1, 50);
    g.tick(0, 1, GIMBAL_RATE_HOLD_MS / 2);
    g.tick(0, 0, 300);
    g.tick(0, 0, 400);
    expect(send.mock.calls).toEqual([
      ["drone-1", 60],
      ["drone-1", 60],
      ["drone-1", 0],
    ]);
  });

  it("stops trying on an agent without the route", async () => {
    const send = vi.fn(async () => 404);
    const g = new GimbalRateDriver("drone-1", 60, send);
    g.tick(0, 1, 0);
    await Promise.resolve();
    await Promise.resolve();
    g.tick(1, 0, 10);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("designate reticle", () => {
  it("ignores controls while closed", () => {
    expect(reticleControl("cross")).toBe(false);
  });

  it("moves on the D-pad and designates on Cross", () => {
    const select = vi.fn();
    setReticleSelect(select);
    toggleReticle();
    expect(reticleControl("dpad_right")).toBe(true);
    expect(reticleControl("dpad_up")).toBe(true);
    expect(reticleControl("cross")).toBe(true);
    expect(select).toHaveBeenCalledWith(0.5 + RETICLE_STEP, 0.5 - RETICLE_STEP);
    expect(useDesignateReticle.getState().open).toBe(false);
  });

  it("cancels on Circle without designating", () => {
    const select = vi.fn();
    setReticleSelect(select);
    toggleReticle();
    expect(reticleControl("circle")).toBe(true);
    expect(select).not.toHaveBeenCalled();
    expect(useDesignateReticle.getState().open).toBe(false);
  });

  it("picks the smallest detection under the point, else a box around it", () => {
    const big = { x: 0, y: 0, width: 100, height: 100 };
    const small = { x: 40, y: 40, width: 20, height: 20 };
    expect(reticleBox(0.5, 0.5, 100, 100, [big, small])).toBe(small);
    expect(reticleBox(0.9, 0.9, 200, 100, [])).toEqual({ x: 175, y: 85, width: 10, height: 10 });
  });
});
