/**
 * @license GPL-3.0-only
 *
 * The latency popover's air-side number describes one agent's live video
 * session. With no agent to poll it must read "not measured", not the last
 * value some earlier agent reported.
 */

import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";

import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useVideoStore } from "@/stores/video-store";
import { useVideoLatencyPoll } from "../use-video-latency-poll";

describe("useVideoLatencyPoll", () => {
  it("clears the previous agent's air latency when no agent is connected", () => {
    useVideoStore.getState().setAirLatency({ airLatencyMs: 120, airSamples: 30, airSource: "sei" });
    useVideoStore.setState({ agentVideoState: "running" });
    useAgentConnectionStore.setState({ agentUrl: null, apiKey: null });

    renderHook(() => useVideoLatencyPoll());

    expect(useVideoStore.getState().latency.airLatencyMs).toBeNull();
  });
});
