/**
 * @module poll-backoff.test
 * @description Unit coverage for the agent poll cadence. Math.random is
 * stubbed so the jitter term is deterministic and the ceiling can be
 * asserted exactly.
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  nextPollDelay,
  OFFLINE_FAILURE_THRESHOLD,
  POLL_BACKOFF_MAX_MULTIPLE,
  POLL_BASE_MS,
  POLL_BASE_RELAY_MS,
} from "../poll-backoff";

describe("nextPollDelay", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("holds the base cadence until the offline threshold", () => {
    expect(nextPollDelay(0, POLL_BASE_MS)).toBe(POLL_BASE_MS);
    expect(nextPollDelay(OFFLINE_FAILURE_THRESHOLD - 1, POLL_BASE_MS)).toBe(
      POLL_BASE_MS,
    );
    expect(nextPollDelay(0, POLL_BASE_RELAY_MS)).toBe(POLL_BASE_RELAY_MS);
  });

  it("ramps geometrically from the base once offline", () => {
    expect(nextPollDelay(OFFLINE_FAILURE_THRESHOLD, POLL_BASE_MS)).toBe(
      POLL_BASE_MS * 2,
    );
    expect(nextPollDelay(OFFLINE_FAILURE_THRESHOLD + 1, POLL_BASE_MS)).toBe(
      POLL_BASE_MS * 4,
    );
    expect(nextPollDelay(OFFLINE_FAILURE_THRESHOLD, POLL_BASE_RELAY_MS)).toBe(
      POLL_BASE_RELAY_MS * 2,
    );
  });

  it("backs off by the same multiple of the base on both lanes", () => {
    // The ceiling is a property of how far past its own cadence a lane
    // may back off, not an absolute wall-clock number. A shared absolute
    // ceiling would let the LAN lane (3 s base) back off 10x while the
    // relay lane (10 s base) backed off only 3x — least backoff on the
    // lane that costs scarce radio airtime.
    const lan = nextPollDelay(100, POLL_BASE_MS);
    const relay = nextPollDelay(100, POLL_BASE_RELAY_MS);
    expect(lan / POLL_BASE_MS).toBe(relay / POLL_BASE_RELAY_MS);
  });

  it("caps each lane at its own base times the max multiple", () => {
    expect(nextPollDelay(100, POLL_BASE_MS)).toBe(
      POLL_BASE_MS * POLL_BACKOFF_MAX_MULTIPLE,
    );
    expect(nextPollDelay(100, POLL_BASE_RELAY_MS)).toBe(
      POLL_BASE_RELAY_MS * POLL_BACKOFF_MAX_MULTIPLE,
    );
  });

  it("adds jitter below one second on top of the derived delay", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const delay = nextPollDelay(100, POLL_BASE_RELAY_MS);
    expect(delay).toBeGreaterThan(
      POLL_BASE_RELAY_MS * POLL_BACKOFF_MAX_MULTIPLE,
    );
    expect(delay).toBeLessThan(
      POLL_BASE_RELAY_MS * POLL_BACKOFF_MAX_MULTIPLE + 1000,
    );
  });
});
