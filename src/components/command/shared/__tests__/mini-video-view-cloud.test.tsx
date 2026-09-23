/**
 * The cloud-relay thumbnail is "streaming" only while frames play: when the
 * player resets the element for a relay reconnect or a stall, the tile goes
 * back to its CONNECTING placeholder instead of sitting black.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";

const mint = vi.hoisted(() => vi.fn());
vi.mock("convex/react", () => ({ useAction: () => mint }));
vi.mock("@/hooks/use-convex-skip-query", () => ({ useConvexSkipQuery: () => undefined }));
vi.mock("@/hooks/use-singleton-agent-video", () => ({
  useSingletonAgentVideo: () => ({ state: "idle" }),
}));
vi.mock("@/hooks/use-resolved-agent-video", () => ({
  useResolvedAgentVideo: () => ({ whepUrl: null, videoState: null }),
}));
vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: { cloudMode: boolean; cloudDeviceId: string }) => unknown) =>
    sel({ cloudMode: true, cloudDeviceId: "drone-1" }),
}));
vi.mock("@/lib/video/mse-player", () => ({
  MsePlayer: class {
    start() {}
    stop() {}
  },
}));

import { MiniVideoView } from "../MiniVideoView";
import { useVideoStore } from "@/stores/video-store";

beforeEach(() => {
  cleanup();
  useVideoStore.setState({ cloudStreaming: false });
});

describe("MiniVideoView cloud relay", () => {
  it("returns to CONNECTING when the player resets the element", async () => {
    const { container } = render(<MiniVideoView />);
    const video = container.querySelector("video")!;

    await act(async () => {
      video.dispatchEvent(new Event("playing"));
    });
    expect(screen.queryByText("CONNECTING...")).toBeNull();

    // Relay dropped: the player's reconnect sets `src = ''`.
    await act(async () => {
      video.dispatchEvent(new Event("emptied"));
    });
    expect(screen.getByText("CONNECTING...")).toBeDefined();
    expect(useVideoStore.getState().cloudStreaming).toBe(false);

    await act(async () => {
      video.dispatchEvent(new Event("playing"));
    });
    expect(screen.queryByText("CONNECTING...")).toBeNull();
  });
});
