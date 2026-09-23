import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useVideoStreams } from "@/hooks/use-video-streams";
import { useVideoStreamsStore } from "@/stores/video-streams-store";
import { useVideoStore } from "@/stores/video-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type { AgentClient } from "@/lib/agent/agent-client/client";
import type { VideoStreamLeg, CameraCapability } from "@/lib/agent/feature-types";

const DRONE = "node:d1";

function leg(
  id: string,
  role?: string,
  live?: boolean | null,
): VideoStreamLeg {
  return {
    id,
    role,
    codec: "h264",
    whepUrl: `http://host:8889/${id}/whep`,
    ...(live !== undefined ? { live } : {}),
  };
}

function camera(name: string, device: string): CameraCapability {
  return { name, device } as CameraCapability;
}

function switchCameraSpy() {
  const spy = vi.fn(async () => {});
  useAgentConnectionStore.setState({
    client: { switchCamera: spy } as unknown as AgentClient,
  });
  return spy;
}

describe("useVideoStreams", () => {
  beforeEach(() => {
    useVideoStreamsStore.getState().clear();
    useAgentCapabilitiesStore.getState().clear();
    useVideoStore.getState().setWhepUrlOverride(null);
    useAgentConnectionStore.setState({ client: null });
  });
  afterEach(cleanup);

  it("points the override at a non-default concurrent leg, then clears it when the stream list empties", () => {
    switchCameraSpy();
    act(() => {
      useAgentCapabilitiesStore.setState({
        videoStreams: [leg("main", "eo"), leg("ir", "ir")],
      });
    });
    renderHook(() => useVideoStreams(DRONE));

    // Select the second (non-default) leg → the override points at its own URL.
    act(() => {
      useVideoStreamsStore.getState().selectStream(DRONE, 2);
    });
    expect(useVideoStore.getState().whepUrlOverride).toBe(
      "http://host:8889/ir/whep",
    );

    // The node stops advertising streams (streams drop to 0): the override must
    // be cleared so the cascade falls back to the default URL, not a dead leg.
    act(() => {
      useAgentCapabilitiesStore.setState({ videoStreams: [] });
    });
    expect(useVideoStreamsStore.getState().activeStream(DRONE)).toBeNull();
    expect(useVideoStore.getState().whepUrlOverride).toBeNull();
  });

  it("drives the override from the first/default leg's own URL, not the poller default", () => {
    switchCameraSpy();
    act(() => {
      useAgentCapabilitiesStore.setState({
        // The first advertised leg id is NOT the poller default ("main"), so a
        // tab-1 selection that fell back to the poller URL would show the wrong
        // camera. The override must carry this leg's own WHEP URL.
        videoStreams: [leg("eo_zoom", "eo"), leg("ir", "ir")],
      });
    });
    renderHook(() => useVideoStreams(DRONE));

    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe(
      "eo_zoom",
    );
    expect(useVideoStore.getState().whepUrlOverride).toBe(
      "http://host:8889/eo_zoom/whep",
    );

    // Switching to leg 2 then back to leg 1 keeps the override on the exact leg.
    act(() => {
      useVideoStreamsStore.getState().selectStream(DRONE, 2);
    });
    expect(useVideoStore.getState().whepUrlOverride).toBe(
      "http://host:8889/ir/whep",
    );
    act(() => {
      useVideoStreamsStore.getState().selectStream(DRONE, 1);
    });
    expect(useVideoStore.getState().whepUrlOverride).toBe(
      "http://host:8889/eo_zoom/whep",
    );
  });

  it("does not re-point the video at a known-dead concurrent leg", () => {
    switchCameraSpy();
    act(() => {
      useAgentCapabilitiesStore.setState({
        // leg 1 live, leg 2 dead (live === false), leg 3 not-yet-sampled.
        videoStreams: [leg("main", "eo", true), leg("ir", "ir", false), leg("wide", "eo", null)],
      });
    });
    renderHook(() => useVideoStreams(DRONE));
    // Mount points at the live default leg.
    expect(useVideoStore.getState().whepUrlOverride).toBe(
      "http://host:8889/main/whep",
    );

    // Selecting the DEAD leg (as a hotkey would, bypassing the disabled tab)
    // must NOT re-point the cascade at its dead URL.
    act(() => {
      useVideoStreamsStore.getState().selectStream(DRONE, 2);
    });
    expect(useVideoStore.getState().whepUrlOverride).toBe(
      "http://host:8889/main/whep",
    );

    // A not-yet-sampled leg (live === null) flips normally.
    act(() => {
      useVideoStreamsStore.getState().selectStream(DRONE, 3);
    });
    expect(useVideoStore.getState().whepUrlOverride).toBe(
      "http://host:8889/wide/whep",
    );
  });

  it("does not fire switchCamera for a carried-over concurrent id on a concurrent→switchable transition", () => {
    const spy = switchCameraSpy();
    act(() => {
      useAgentCapabilitiesStore.setState({
        videoStreams: [leg("main", "eo"), leg("ir", "ir")],
      });
    });
    renderHook(() => useVideoStreams(DRONE));

    act(() => {
      useVideoStreamsStore.getState().selectStream(DRONE, 2); // "ir"
    });
    expect(useVideoStore.getState().whepUrlOverride).toBe(
      "http://host:8889/ir/whep",
    );

    // The switch mechanism flips to switchable (per-leg legs gone, a camera
    // roster arrives). The carried-over "ir" id is not a switchable device leg,
    // so no switchCamera must fire, and the override must be cleared.
    act(() => {
      useAgentCapabilitiesStore.setState({
        videoStreams: [],
        cameras: [camera("USB Camera", "/dev/video0"), camera("CSI", "/dev/video1")],
      });
    });
    expect(spy).not.toHaveBeenCalled();
    expect(useVideoStore.getState().whepUrlOverride).toBeNull();
    // The active id defaulted to the first switchable device leg.
    expect(useVideoStreamsStore.getState().activeStream(DRONE)?.id).toBe(
      "/dev/video0",
    );
  });
});
