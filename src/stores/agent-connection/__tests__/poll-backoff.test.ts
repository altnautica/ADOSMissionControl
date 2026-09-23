/**
 * @module poll-backoff.test
 * @description The agent poll holds its base cadence while the agent answers
 * and, once it is declared offline, retries forever at a fixed 2-5 s: 3 s on
 * the LAN and 5 s over the relay, never an exponential backoff.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import {
  nextPollDelay,
  OFFLINE_FAILURE_THRESHOLD,
  POLL_BASE_MS,
  POLL_BASE_RELAY_MS,
} from "../poll-backoff";

describe("nextPollDelay", () => {
  it("holds the base cadence until the offline threshold", () => {
    expect(nextPollDelay(0, POLL_BASE_MS)).toBe(POLL_BASE_MS);
    expect(nextPollDelay(OFFLINE_FAILURE_THRESHOLD - 1, POLL_BASE_MS)).toBe(POLL_BASE_MS);
    expect(nextPollDelay(0, POLL_BASE_RELAY_MS)).toBe(POLL_BASE_RELAY_MS);
  });

  it("retries an offline agent at a fixed 3 s on the LAN and 5 s over the relay", () => {
    for (const failures of [OFFLINE_FAILURE_THRESHOLD, OFFLINE_FAILURE_THRESHOLD + 1, 50, 10_000]) {
      expect(nextPollDelay(failures, POLL_BASE_MS)).toBe(3000);
      expect(nextPollDelay(failures, POLL_BASE_RELAY_MS)).toBe(5000);
    }
  });

  it("keeps a fast poll's offline retry at 2 s or more", () => {
    expect(nextPollDelay(OFFLINE_FAILURE_THRESHOLD, 1000)).toBe(2000);
  });
});
