/**
 * @license GPL-3.0-only
 *
 * The HUD readout freshness gate: a stale or absent sample must NOT read as
 * live (Rule 44). isTimestampFresh is the pure gate the canvas HUD loops use.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useTelemetryStore } from "@/stores/telemetry-store";
import {
  isTimestampFresh,
  TELEMETRY_FRESH_MS,
  useTelemetryFreshness,
} from "../use-telemetry-freshness";

afterEach(() => {
  vi.useRealTimers();
  useTelemetryStore.getState().clear();
});

function pushAttitudeNow() {
  useTelemetryStore.getState().pushAttitude({
    timestamp: Date.now(),
    roll: 0,
    pitch: 0,
    yaw: 0,
    rollSpeed: 0,
    pitchSpeed: 0,
    yawSpeed: 0,
  });
}

describe("isTimestampFresh", () => {
  it("is true for a just-now sample", () => {
    vi.useFakeTimers();
    const now = 1_000_000;
    vi.setSystemTime(now);
    expect(isTimestampFresh(now)).toBe(true);
    expect(isTimestampFresh(now - (TELEMETRY_FRESH_MS - 1))).toBe(true);
  });

  it("is false once the sample is older than the fresh window", () => {
    vi.useFakeTimers();
    const now = 1_000_000;
    vi.setSystemTime(now);
    expect(isTimestampFresh(now - TELEMETRY_FRESH_MS)).toBe(false);
    expect(isTimestampFresh(now - (TELEMETRY_FRESH_MS + 5000))).toBe(false);
  });

  it("is false for an absent timestamp (never blanks-to-live)", () => {
    expect(isTimestampFresh(undefined)).toBe(false);
    expect(isTimestampFresh(null)).toBe(false);
    expect(isTimestampFresh(Number.NaN)).toBe(false);
  });

  it("honors a custom max-age window", () => {
    vi.useFakeTimers();
    const now = 1_000_000;
    vi.setSystemTime(now);
    expect(isTimestampFresh(now - 4000, 5000)).toBe(true);
    expect(isTimestampFresh(now - 6000, 5000)).toBe(false);
  });
});

describe("useTelemetryFreshness", () => {
  it("decays a silent channel even though a dead link makes no store changes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    pushAttitudeNow();

    const { result } = renderHook(() => useTelemetryFreshness());

    // One second on, the sample is still inside the fresh window.
    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.getFreshness("attitude")).toBe("fresh");

    // Nothing is pushed from here on: this is the link-death case, where the
    // ring buffer keeps its last sample and the store never changes again.
    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current.getFreshness("attitude")).toBe("stale");

    act(() => void vi.advanceTimersByTime(3000));
    expect(result.current.getFreshness("attitude")).toBe("lost");
  });

  it("reports an empty channel as none rather than fresh", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    const { result } = renderHook(() => useTelemetryFreshness());

    act(() => void vi.advanceTimersByTime(1000));
    expect(result.current.getFreshness("attitude")).toBe("none");
    expect(result.current.overall).toBe("none");
  });

  it("picks up a new sample without waiting for the next interval tick", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);

    const { result } = renderHook(() => useTelemetryFreshness());
    expect(result.current.getFreshness("attitude")).toBe("none");

    act(() => {
      pushAttitudeNow();
      // Well short of the 1s interval, so only the store subscription can
      // account for the transition.
      vi.advanceTimersByTime(50);
    });

    expect(result.current.getFreshness("attitude")).toBe("fresh");
  });

  it("does not re-render while samples arrive without moving a level", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    pushAttitudeNow();

    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useTelemetryFreshness();
    });

    act(() => void vi.advanceTimersByTime(50));
    const settled = renders;
    const before = result.current;

    // Every sample bumps the store version. None of them move a channel off
    // "fresh", so none of them should cost a render.
    act(() => {
      for (let i = 0; i < 20; i++) {
        pushAttitudeNow();
        vi.advanceTimersByTime(20);
      }
    });

    expect(renders).toBe(settled);
    expect(result.current).toBe(before);
  });
});
