/**
 * @module mock/stale-telemetry-fixture.test
 * @description Demo mode must be able to produce a stale link.
 *
 * The cockpit safety band, the HUD attitude flag, the proximity radar, the
 * telemetry strip and the LINK STALE badge all key off how old a sample is,
 * and every one of them shipped painting a dead link as live. They shipped
 * that way because nothing in demo mode could produce a stale reading: the
 * ring buffers were fed continuously, so the defect only appeared on a real
 * link loss in the field, which is the worst possible place to find it.
 *
 * `freezeTelemetry` leaves the last samples in place and lets the clock age
 * them — what a dead radio looks like from the GCS — so the gated paths are
 * reachable from `npm run demo`.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockEngine } from "@/mock/engine";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { freshOnly, TELEMETRY_STALE_MS } from "@/lib/telemetry/freshness";

describe("demo stale-telemetry fixture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    mockEngine.stop();
    vi.useRealTimers();
  });

  it("reports telemetry flowing while the engine runs", () => {
    mockEngine.start(50);
    expect(mockEngine.telemetryFlowing).toBe(true);
  });

  it("stops flowing when frozen and resumes on demand", () => {
    mockEngine.start(50);
    mockEngine.freezeTelemetry();
    expect(mockEngine.telemetryFlowing).toBe(false);

    mockEngine.resumeTelemetry();
    expect(mockEngine.telemetryFlowing).toBe(true);
  });

  it("holds the last sample so age alone flips the freshness gate", () => {
    // The engine feeds each drone's mock protocol, and `bridgeTelemetry`
    // mirrors that into the store only for a drone connected through the
    // drone manager. This asserts the property the fixture exists to give the
    // gated surfaces, against the store the way the bridge writes it: a frozen
    // link keeps its history, and the clock is what makes it stale.
    const sample = {
      timestamp: Date.now(),
      voltage: 16.4,
      current: 11.2,
      remaining: 63,
      consumed: 900,
    };
    useTelemetryStore.getState().pushBattery(sample);

    mockEngine.start(50);
    mockEngine.freezeTelemetry();

    const held = useTelemetryStore.getState().battery.latest();
    expect(held?.timestamp).toBe(sample.timestamp);

    const frozenAt = sample.timestamp;
    expect(freshOnly(held, frozenAt)).toBeDefined();
    expect(freshOnly(held, frozenAt + TELEMETRY_STALE_MS + 1)).toBeUndefined();
  });

  it("does not double-schedule when resumed twice", () => {
    mockEngine.start(50);
    mockEngine.freezeTelemetry();
    mockEngine.resumeTelemetry();
    mockEngine.resumeTelemetry();
    expect(mockEngine.telemetryFlowing).toBe(true);

    // One interval, so one freeze stops it. A second scheduled interval would
    // keep feeding the buffers and make the fixture useless.
    mockEngine.freezeTelemetry();
    expect(mockEngine.telemetryFlowing).toBe(false);

    // A second scheduled interval would survive the freeze and keep ticking.
    const ticks: number[] = [];
    const spy = vi.spyOn(mockEngine, "tick").mockImplementation(() => {
      ticks.push(Date.now());
    });
    vi.advanceTimersByTime(1_000);
    expect(ticks, "a frozen engine must not tick").toHaveLength(0);
    spy.mockRestore();
  });

  it("refuses to resume a stopped engine", () => {
    mockEngine.start(50);
    mockEngine.stop();
    mockEngine.resumeTelemetry();
    expect(mockEngine.telemetryFlowing).toBe(false);
  });
});
