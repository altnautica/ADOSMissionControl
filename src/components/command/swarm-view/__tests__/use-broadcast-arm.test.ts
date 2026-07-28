/**
 * @module command/swarm-view/use-broadcast-arm.test
 * @description The fleet-wide gate that closes itself.
 *
 * The whole value of this control is that it decays. A sticky "aim at
 * everything" mode is a mode an operator forgets they are in, and the entire
 * fleet is the worst possible thing to be accidentally pointed at. So the
 * five-second revert is not cosmetic — it is the safety property — and it is
 * pinned here against fake timers rather than felt out in a browser.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { BROADCAST_ARM_MS, useBroadcastArm } from "../use-broadcast-arm";

describe("useBroadcastArm", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts disarmed", () => {
    const { result } = renderHook(() => useBroadcastArm());
    expect(result.current.armed).toBe(false);
    expect(result.current.armedUntil).toBeNull();
  });

  it("stays armed right up to the window and reverts on it", () => {
    const { result } = renderHook(() => useBroadcastArm());

    act(() => result.current.arm());
    expect(result.current.armed).toBe(true);

    act(() => void vi.advanceTimersByTime(BROADCAST_ARM_MS - 1));
    expect(result.current.armed).toBe(true);

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.armed).toBe(false);
    expect(result.current.armedUntil).toBeNull();
  });

  it("reverts five seconds after arming", () => {
    const { result } = renderHook(() => useBroadcastArm());
    act(() => result.current.arm());
    act(() => void vi.advanceTimersByTime(5000));
    expect(result.current.armed).toBe(false);
  });

  it("restarts the window on re-arm rather than extending it", () => {
    // Mashing the button must not accumulate a longer gate than one press buys.
    const { result } = renderHook(() => useBroadcastArm());

    act(() => result.current.arm());
    const first = result.current.armedUntil;

    act(() => void vi.advanceTimersByTime(BROADCAST_ARM_MS - 500));
    act(() => result.current.arm());
    expect(result.current.armedUntil).toBeGreaterThan(first ?? 0);

    // The original timer would have fired here; the restart must have cancelled it.
    act(() => void vi.advanceTimersByTime(500));
    expect(result.current.armed).toBe(true);

    act(() => void vi.advanceTimersByTime(BROADCAST_ARM_MS - 500));
    expect(result.current.armed).toBe(false);
  });

  it("disarms immediately and cancels the pending revert", () => {
    const { result } = renderHook(() => useBroadcastArm());
    act(() => result.current.arm());
    act(() => result.current.disarm());
    expect(result.current.armed).toBe(false);

    // A stale timer firing later must not be able to disarm a fresh arm.
    act(() => result.current.arm());
    act(() => void vi.advanceTimersByTime(BROADCAST_ARM_MS - 1));
    expect(result.current.armed).toBe(true);
  });

  it("does not leave a timer behind when the action bar unmounts", () => {
    const { result, unmount } = renderHook(() => useBroadcastArm());
    act(() => result.current.arm());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("honours a caller-supplied window", () => {
    const { result } = renderHook(() => useBroadcastArm(1200));
    act(() => result.current.arm());
    act(() => void vi.advanceTimersByTime(1199));
    expect(result.current.armed).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.armed).toBe(false);
  });
});
