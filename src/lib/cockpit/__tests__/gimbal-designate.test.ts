/**
 * @license GPL-3.0-only
 *
 * The controller's camera bindings: L2 / R2 drive the gimbal pitch rate on
 * the agent (full travel = the spec's 60 °/s, renewed inside the hold, one
 * zero on release), and the touchpad's designate reticle moves on the D-pad,
 * designates on Cross and cancels on Circle.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { GIMBAL_RATE_BACKOFF_MS, GIMBAL_RATE_HOLD_MS, GimbalRateDriver, triggerPitchDps } from "../gimbal-rate";
import {
  RETICLE_STEP,
  reticleBox,
  reticleControl,
  setReticleSelect,
  toggleReticle,
  useDesignateReticle,
} from "../designate-reticle";

afterEach(() => {
  vi.useRealTimers();
  useDesignateReticle.setState({ open: false, x: 0.5, y: 0.5, onSelect: null });
});

describe("gimbal pitch rate from the triggers", () => {
  it("maps full R2 to +60 and full L2 to -60, ignoring the deadband", () => {
    expect(triggerPitchDps(0, 1, 60)).toBe(60);
    expect(triggerPitchDps(1, 0, 60)).toBe(-60);
    expect(triggerPitchDps(0.02, 0.03, 60)).toBe(0);
  });

  it("sends on change, renews within the hold and sends one zero on release", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (_d: string, _p: number, _y: number) => 200);
    const g = new GimbalRateDriver("drone-1", 60, send);
    g.tick(0, 1);
    await vi.advanceTimersByTimeAsync(50);
    g.tick(0, 1);
    await vi.advanceTimersByTimeAsync(GIMBAL_RATE_HOLD_MS / 2);
    g.tick(0, 0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(send.mock.calls).toEqual([
      ["drone-1", 60, 0],
      ["drone-1", 60, 0],
      ["drone-1", 0, 0],
    ]);
    g.stop();
  });

  it("quantises trigger jitter and sends at most about 10 changes a second", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (_d: string, _p: number, _y: number) => 200);
    const g = new GimbalRateDriver("drone-1", 60, send);
    // A held half press with jitter of a few counts out of 255.
    for (let i = 0; i < 20; i++) {
      g.tick(0, 0.5 + ((i % 3) - 1) / 255);
      await vi.advanceTimersByTimeAsync(50);
    }
    // 1 s held: the first send plus renewals every half hold, no jitter sends.
    expect(send.mock.calls.length).toBeLessThanOrEqual(5);
    expect(new Set(send.mock.calls.map((c) => c[1]))).toEqual(new Set([30]));
    // Fast changes: one in flight at a time, at most one per 100 ms.
    send.mockClear();
    for (let i = 0; i < 10; i++) {
      g.set(i * 10, 0);
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(send.mock.calls.length).toBeLessThanOrEqual(2);
    g.stop();
    await vi.advanceTimersByTimeAsync(500);
  });

  it("never lets an older non-zero rate land after the zero", async () => {
    vi.useFakeTimers();
    const order: number[] = [];
    let release: (() => void) | null = null;
    const send = vi.fn((_d: string, p: number) => {
      order.push(p);
      return new Promise<number>((resolve) => {
        release = () => resolve(200);
      });
    });
    const g = new GimbalRateDriver("drone-1", 60, send);
    g.set(40, 0);
    g.set(0, 0); // released while the 40 is in flight
    expect(order).toEqual([40]);
    release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual([40, 0]);
    release!();
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual([40, 0]);
  });

  it("backs off on 429 and still delivers the zero", async () => {
    vi.useFakeTimers();
    const statuses = [200, 429, 200];
    const send = vi.fn(async () => statuses.shift() ?? 200);
    const g = new GimbalRateDriver("drone-1", 60, send);
    g.set(40, 0);
    await vi.advanceTimersByTimeAsync(0);
    g.set(0, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(2); // the zero met the rate limit
    await vi.advanceTimersByTimeAsync(GIMBAL_RATE_BACKOFF_MS / 2);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(GIMBAL_RATE_BACKOFF_MS);
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]).toEqual(["drone-1", 0, 0]);
  });

  it("stops trying on an agent without the route", async () => {
    const send = vi.fn(async () => 404);
    const g = new GimbalRateDriver("drone-1", 60, send);
    g.tick(0, 1);
    await Promise.resolve();
    await Promise.resolve();
    g.tick(1, 0);
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

  it("does not open, or take Circle, Cross or the D-pad, with no target layer to draw it", () => {
    toggleReticle();
    expect(useDesignateReticle.getState().open).toBe(false);
    // Circle (stop skill), Cross and the D-pad reach their bindings.
    for (const c of ["circle", "cross", "dpad_up"]) expect(reticleControl(c)).toBe(false);
  });

  it("closes when the target layer goes away (view change, cockpit closed)", () => {
    setReticleSelect(vi.fn());
    toggleReticle();
    expect(useDesignateReticle.getState().open).toBe(true);
    setReticleSelect(null);
    expect(useDesignateReticle.getState().open).toBe(false);
    expect(reticleControl("circle")).toBe(false);
  });

  it("picks the smallest detection under the point, else a box around it", () => {
    const big = { x: 0, y: 0, width: 100, height: 100 };
    const small = { x: 40, y: 40, width: 20, height: 20 };
    expect(reticleBox(0.5, 0.5, 100, 100, [big, small])).toBe(small);
    expect(reticleBox(0.9, 0.9, 200, 100, [])).toEqual({ x: 175, y: 85, width: 10, height: 10 });
  });
});
