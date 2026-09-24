/**
 * @license GPL-3.0-only
 *
 * The singleton video session stays enabled through a short "not running"
 * blip from the agent, and is disabled once the agent has kept reporting video
 * as not running for the grace window. A steady report never changes the
 * prop, so the gate has to be driven by time, not by re-renders.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

const enabledCalls: boolean[] = [];

vi.mock("@/hooks/use-video-transport-cascade", () => ({
  useVideoTransportCascade: (opts: { enabled: boolean }) => {
    enabledCalls.push(opts.enabled);
    return { state: "idle", activeTransport: null, error: null };
  },
}));

import { useSingletonAgentVideo } from "../use-singleton-agent-video";

afterEach(() => {
  enabledCalls.length = 0;
  vi.useRealTimers();
});

function render(agentVideoState: string) {
  return renderHook(
    ({ state }: { state: string }) =>
      useSingletonAgentVideo({
        whepUrl: "http://192.168.1.50:8889/main/whep",
        cloudDeviceId: null,
        transportMode: "auto",
        videoEl: null,
        agentVideoState: state,
      }),
    { initialProps: { state: agentVideoState } },
  );
}

describe("useSingletonAgentVideo enable gate", () => {
  it("disables the session after the agent keeps reporting video stopped", () => {
    vi.useFakeTimers();
    const { rerender } = render("running");
    rerender({ state: "stopped" });
    // Steady polls re-report the same state: no prop change at all.
    rerender({ state: "stopped" });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(enabledCalls.at(-1)).toBe(false);
  });

  it("stays enabled through a blip shorter than the grace window", () => {
    vi.useFakeTimers();
    const { rerender } = render("running");
    rerender({ state: "stopped" });
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    rerender({ state: "running" });
    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(enabledCalls.every(Boolean)).toBe(true);
  });
});
