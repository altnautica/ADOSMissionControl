/**
 * A drone reached through a paired ground station has no singleton video
 * state: its feed is the funnelled one on its fleet-status row. The video
 * surfaces resolve that feed, and the connection gates must see the same
 * resolved state, or a failed first attempt is never retried and a frozen
 * stream is never re-dialled.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each dial (mount or retry-key bump) goes connecting, then settles after
// 500 ms to the outcome the test chose, as the real transport cascade does.
const cascade = vi.hoisted(() => ({
  outcome: "failed" as "connected" | "failed",
  calls: [] as Array<{ agentWhepUrl: string | null; retryKey: number; enabled: boolean }>,
}));

vi.mock("idb-keyval", () => {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    keys: vi.fn(async () => Array.from(store.keys())),
    createStore: vi.fn(() => ({})),
  };
});

vi.mock("@/hooks/use-video-transport-cascade", async () => {
  const { useEffect, useState } = await vi.importActual<typeof import("react")>("react");
  return {
    useVideoTransportCascade: (opts: {
      agentWhepUrl: string | null;
      retryKey: number;
      enabled: boolean;
    }) => {
      const [state, setState] = useState<"idle" | "connecting" | "connected" | "failed">("idle");
      cascade.calls.push({
        agentWhepUrl: opts.agentWhepUrl,
        retryKey: opts.retryKey,
        enabled: opts.enabled,
      });
      useEffect(() => {
        setState("connecting");
        const handle = setTimeout(() => setState(cascade.outcome), 500);
        return () => clearTimeout(handle);
      }, [opts.retryKey]);
      return { state, activeTransport: null, error: state === "failed" ? "WHEP offer refused" : null };
    },
  };
});

import { VideoBackground } from "@/components/hud/VideoBackground";
import { useVideoStore } from "@/stores/video-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useCommandFleetStore } from "@/stores/command-fleet-store";

const DRONE = "drone-relayed";
const FUNNELLED_URL = "http://192.168.1.50:8080/main/whep";

function lastRetryKey(): number {
  return cascade.calls[cascade.calls.length - 1]?.retryKey ?? -1;
}

beforeEach(() => {
  vi.useFakeTimers();
  cascade.outcome = "failed";
  // The singleton store knows nothing about a relayed drone.
  useVideoStore.setState({ agentVideoState: "unknown", agentWhepUrl: null });
  useAgentConnectionStore.setState({ cloudDeviceId: DRONE });
  useCommandFleetStore.setState({
    cloudStatuses: {
      [DRONE]: { deviceId: DRONE, videoState: "running", videoWhepUrl: FUNNELLED_URL, updatedAt: Date.now() },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("funnelled agent video recovery", () => {
  it("re-dials a failed funnelled feed on a fixed interval, indefinitely", () => {
    render(<VideoBackground />);
    const first = lastRetryKey();
    expect(cascade.calls.at(-1)?.agentWhepUrl).toBe(FUNNELLED_URL);

    for (let attempt = 1; attempt <= 3; attempt++) {
      // The dial fails, then the retry waits its full fixed interval.
      act(() => {
        vi.advanceTimersByTime(500);
      });
      act(() => {
        vi.advanceTimersByTime(2_900);
      });
      expect(lastRetryKey()).toBe(first + attempt - 1);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(lastRetryKey()).toBe(first + attempt);
    }
  });

  it("re-dials a frozen funnelled feed on the stall signal", () => {
    cascade.outcome = "connected";
    render(<VideoBackground />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    const before = lastRetryKey();

    act(() => {
      useVideoStore.getState().signalVideoStall();
    });

    expect(lastRetryKey()).toBe(before + 1);
  });
});
