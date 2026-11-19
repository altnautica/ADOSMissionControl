/**
 * A node whose Navigation answers "unavailable" (503) keeps being polled at
 * the slower period, and the hook goes live once it serves, without remount.
 *
 * @license GPL-3.0-only
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Utils from "@/lib/utils";

const pluginHttp = vi.fn();

vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<typeof Utils>()),
  isDemoMode: () => false,
}));
vi.mock("@/lib/plugins/node-agent-reach", () => ({
  resolveNodeAgentReach: () => ({ kind: "lan" }),
  pluginClientForReach: () => ({ pluginHttp }),
}));
vi.mock("@/components/drone-detail/map/sweep-cloud", () => ({
  emptySweepCloud: () => ({ seq: null }),
  applySweep: (c: unknown) => c,
  parseSweep: () => null,
}));

import { SWEEP_UNAVAILABLE_POLL_MS, useLiveSweep } from "@/hooks/use-live-sweep";

function reply(status: number) {
  return {
    status,
    ok: status >= 200 && status < 300,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

describe("useLiveSweep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pluginHttp.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers from a 503 to live without a remount", async () => {
    pluginHttp.mockResolvedValueOnce(reply(503)).mockResolvedValue(reply(200));
    const { result } = renderHook(() => useLiveSweep("drone-1", true));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.state).toBe("unavailable");
    expect(pluginHttp).toHaveBeenCalledTimes(1);

    // Not re-asked at the normal 1 s period while unavailable.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SWEEP_UNAVAILABLE_POLL_MS - 1);
    });
    expect(pluginHttp).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(pluginHttp).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("live");
  });
});
