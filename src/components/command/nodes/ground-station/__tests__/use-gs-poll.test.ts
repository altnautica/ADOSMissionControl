/**
 * @module ground-station/use-gs-poll.test
 * @description The shared ground-station poll keeps one request in flight and
 * a fixed cadence: a slow node never gets overlapping requests, and a node that
 * keeps failing is retried at the same interval rather than backed off.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useGroundStationPoll } from "../use-gs-poll";

const BASE_MS = 2000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGroundStationPoll", () => {
  it("never starts a request while the previous one is outstanding", async () => {
    const pending = Promise.withResolvers<void>();
    const run = vi.fn(() => pending.promise);
    renderHook(() => useGroundStationPoll("http://192.168.1.50:8080", "k", BASE_MS, run));
    expect(run).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(BASE_MS * 5);
    });
    expect(run).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(BASE_MS);
    });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("retries a failing node at the fixed cadence", async () => {
    const run = vi.fn(async () => {
      throw new Error("unreachable");
    });
    renderHook(() => useGroundStationPoll("http://192.168.1.50:8080", "k", BASE_MS, run));
    await act(async () => {});
    expect(run).toHaveBeenCalledTimes(1);

    for (let i = 2; i <= 6; i += 1) {
      await act(async () => {
        vi.advanceTimersByTime(BASE_MS);
      });
      expect(run).toHaveBeenCalledTimes(i);
    }
  });
});
