import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// The mock must expose STABLE function/object references. The hook subscribes
// to `getSelectedProtocol` and runs its effect when that reference changes; a
// fresh function per render (as a naively-returned object literal would) makes
// the effect re-run forever and loop to an OOM.
const mock = vi.hoisted(() => {
  let cb: (() => void) | null = null;
  const protocol = {
    onHeartbeat: (c: () => void) => {
      cb = c;
      return () => {};
    },
  };
  return {
    getSelectedProtocol: () => protocol,
    selectedDroneId: "drone-1",
    fire: () => cb?.(),
  };
});

vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (selector: (s: Record<string, unknown>) => unknown) => selector(mock),
}));

import { useHeartbeatRate } from "@/hooks/use-heartbeat-rate";

describe("useHeartbeatRate stale-when-empty", () => {
  beforeEach(() => {
    // shouldAdvanceTime lets React's internal scheduling (which uses faked
    // `setTimeout`) make progress inside `act`; without it renderHook hangs.
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports stale=true when the ring is empty past the horizon", () => {
    const { result } = renderHook(() => useHeartbeatRate());

    // No heartbeat ever received. Advance past the 1s recompute interval so
    // the stale computation runs against an empty ring: an FC that connected
    // but never heartbeats must NOT show a healthy link.
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(result.current.stale).toBe(true);
    expect(result.current.hz).toBeNull();
  });

  it("reports stale=false just after a heartbeat, then stale=true after silence", () => {
    const { result } = renderHook(() => useHeartbeatRate());

    act(() => {
      mock.fire();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    // One beat, still within the 3s stale window.
    expect(result.current.stale).toBe(false);

    // Go quiet well past the stale window.
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.stale).toBe(true);
  });
});
