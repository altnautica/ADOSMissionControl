/**
 * The node panel keeps the focused node's agent connected: a cloud selection
 * is a working connection, a failed connect is retried on a fixed interval for
 * as long as the node is focused, and the fleet list being rebuilt (it is, on
 * every telemetry update) never redials a connected node.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const select = vi.hoisted(() => ({ outcome: "connected" as string, calls: 0 }));
vi.mock("@/lib/agent/node-click-handler", () => ({
  selectNode: vi.fn(async () => {
    select.calls++;
    return select.outcome;
  }),
}));

import { CONNECT_RETRY_MS, useNodeConnect } from "@/components/dashboard/node-detail/use-node-connect";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";

function entry(over: Partial<FleetNodeEntry> = {}): FleetNodeEntry {
  return { _id: "node:d1", deviceId: "d1", name: "Drone 1", isLocal: false, profile: "drone", ...over } as FleetNodeEntry;
}

beforeEach(() => {
  vi.useFakeTimers();
  select.calls = 0;
  select.outcome = "connected";
});

afterEach(() => {
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useNodeConnect", () => {
  it("treats an open cloud subscription as connected and does not redial", async () => {
    select.outcome = "cloud";
    const { result } = renderHook(() => useNodeConnect("d1", entry()));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_RETRY_MS * 5);
    });
    expect(select.calls).toBe(1);
    expect(result.current.connectFailing).toBe(false);
  });

  it("keeps retrying a failed connect on a fixed interval, with no cap", async () => {
    select.outcome = "failed";
    const { result } = renderHook(() => useNodeConnect("d1", entry({ isLocal: true })));
    await flush();
    expect(result.current.connectFailing).toBe(true);
    for (let i = 0; i < 8; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CONNECT_RETRY_MS);
      });
    }
    expect(select.calls).toBe(9);

    select.outcome = "connected";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_RETRY_MS);
    });
    expect(result.current.connectFailing).toBe(false);
    const settled = select.calls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_RETRY_MS * 3);
    });
    expect(select.calls).toBe(settled);
  });

  it("does not redial when the fleet list is rebuilt with the same node", async () => {
    const { rerender } = renderHook(({ e }) => useNodeConnect("d1", e), { initialProps: { e: entry() } });
    await flush();
    for (let i = 0; i < 5; i++) {
      rerender({ e: entry() });
      await flush();
    }
    expect(select.calls).toBe(1);
  });

  it("does not retry a node nothing can reach from here", async () => {
    select.outcome = "blocked";
    const { result } = renderHook(() => useNodeConnect("d1", entry({ isRelayed: true })));
    await flush();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONNECT_RETRY_MS * 3);
    });
    expect(select.calls).toBe(1);
    expect(result.current.connectFailing).toBe(false);
  });
});
