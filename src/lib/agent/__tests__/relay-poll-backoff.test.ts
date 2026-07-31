import { describe, expect, it } from "vitest";

import {
  nextPollIntervalMs,
  RELAY_POLL_BASE_MS,
  RELAY_POLL_MAX_MS,
} from "@/lib/agent/relay-poll-backoff";

describe("nextPollIntervalMs", () => {
  it("returns to the fast rate the moment a batch arrives", () => {
    // Responsiveness matters more than smoothing once something is actually
    // being tracked, so a fresh batch resets rather than decaying back.
    expect(nextPollIntervalMs(RELAY_POLL_MAX_MS, "fresh")).toBe(RELAY_POLL_BASE_MS);
    expect(nextPollIntervalMs(1000, "fresh")).toBe(RELAY_POLL_BASE_MS);
  });

  it("steps out while nothing is being produced", () => {
    // The common case: vision is not running, and every tick is radio airtime
    // shared with telemetry and any relay call the operator makes.
    const first = nextPollIntervalMs(RELAY_POLL_BASE_MS, "empty");
    expect(first).toBeGreaterThan(RELAY_POLL_BASE_MS);
    expect(nextPollIntervalMs(first, "empty")).toBeGreaterThan(first);
  });

  it("treats a failed poll like an empty one", () => {
    expect(nextPollIntervalMs(RELAY_POLL_BASE_MS, "error")).toBeGreaterThan(
      RELAY_POLL_BASE_MS,
    );
  });

  it("never exceeds the ceiling, however long it stays idle", () => {
    let ms = RELAY_POLL_BASE_MS;
    for (let i = 0; i < 100; i += 1) ms = nextPollIntervalMs(ms, "empty");
    expect(ms).toBe(RELAY_POLL_MAX_MS);
  });

  it("never drops below the base rate", () => {
    // A ceiling that could collapse under the base would poll the radio faster
    // than the fast path itself.
    for (const outcome of ["fresh", "empty", "error"] as const) {
      expect(nextPollIntervalMs(1, outcome)).toBeGreaterThanOrEqual(RELAY_POLL_BASE_MS);
      expect(nextPollIntervalMs(0, outcome)).toBeGreaterThanOrEqual(RELAY_POLL_BASE_MS);
    }
  });

  it("reaches the ceiling within about a second of real time", () => {
    // The ceiling is a tradeoff: too slow and a drone that starts producing
    // detections goes unnoticed. Walk the ramp and check the total elapsed
    // time before it saturates stays small.
    let ms = RELAY_POLL_BASE_MS;
    let elapsed = 0;
    let steps = 0;
    while (ms < RELAY_POLL_MAX_MS && steps < 50) {
      elapsed += ms;
      ms = nextPollIntervalMs(ms, "empty");
      steps += 1;
    }
    expect(elapsed).toBeLessThan(4000);
  });
});
