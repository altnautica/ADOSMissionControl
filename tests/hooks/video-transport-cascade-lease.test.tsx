/**
 * Regression net for the cascade's hold on the shared receive session.
 *
 * The bug had two halves. The registry fixed the first (four surfaces
 * negotiating one stream and closing each other's connection). This is the
 * second: the cascade's cleanup called `stopStream()` unconditionally, for
 * every effect run — including the runs that bail before connecting, on
 * `off`, on `!enabled`, and with no `<video>` element yet. Several instances
 * of this hook are mounted on the same feed, so one surface's unmount
 * released a hold it never took, and the release landed on a live session
 * another surface was rendering.
 *
 * `startStream` / `stopStream` are mocked because the invariant under test is
 * "release exactly what you took", not the SDP exchange.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const startStream = vi.fn<(url: string, signal?: AbortSignal) => Promise<MediaStream>>();
const startStreamViaMqttSignaling = vi.fn();
const stopStream = vi.fn(async () => {});

vi.mock("@/lib/video/webrtc-client", () => ({
  startStream: (...args: Parameters<typeof startStream>) => startStream(...args),
  startStreamViaMqttSignaling: (...args: unknown[]) =>
    startStreamViaMqttSignaling(...args),
  stopStream: () => stopStream(),
}));

const { useVideoTransportCascade } = await import(
  "@/hooks/use-video-transport-cascade"
);

function fakeStream(): MediaStream {
  const track = { kind: "video", readyState: "live", stop: vi.fn() };
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream;
}

const WHEP = "http://192.168.1.50:8889/main/whep";

/**
 * A `<video>` stand-in. A real happy-dom element validates `srcObject`
 * against its `MediaStream` type and rejects a stub stream; the hook only
 * ever assigns that property, so this is the whole surface it touches.
 *
 * Hoisted per test rather than built inside the hook callback: a fresh
 * element per render is a changed effect dependency, which re-runs the
 * cascade forever.
 */
function videoEl(): HTMLVideoElement {
  return { srcObject: null } as unknown as HTMLVideoElement;
}

beforeEach(() => {
  startStream.mockReset();
  stopStream.mockReset();
  startStream.mockResolvedValue(fakeStream());
  stopStream.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cascade session holds", () => {
  it("releases nothing when the run never connected: video off", () => {
    const el = videoEl();
    const { unmount } = renderHook(() =>
      useVideoTransportCascade({
        agentWhepUrl: WHEP,
        cloudDeviceId: null,
        transportMode: "off",
        videoEl: el,
        retryKey: 0,
        enabled: true,
      }),
    );
    expect(startStream).not.toHaveBeenCalled();
    unmount();
    // An unconditional release here reaches into a session this surface
    // never acquired — and tears down whatever another surface is watching.
    expect(stopStream).not.toHaveBeenCalled();
  });

  it("releases nothing when the agent is not running", () => {
    const el = videoEl();
    const { unmount } = renderHook(() =>
      useVideoTransportCascade({
        agentWhepUrl: WHEP,
        cloudDeviceId: null,
        transportMode: "auto",
        videoEl: el,
        retryKey: 0,
        enabled: false,
      }),
    );
    unmount();
    expect(startStream).not.toHaveBeenCalled();
    expect(stopStream).not.toHaveBeenCalled();
  });

  it("releases nothing when there is no video element yet", () => {
    const { unmount } = renderHook(() =>
      useVideoTransportCascade({
        agentWhepUrl: WHEP,
        cloudDeviceId: null,
        transportMode: "auto",
        videoEl: null,
        retryKey: 0,
        enabled: true,
      }),
    );
    unmount();
    expect(stopStream).not.toHaveBeenCalled();
  });

  it("releases exactly one hold after a successful connect", async () => {
    const el = videoEl();
    const { result, unmount } = renderHook(() =>
      useVideoTransportCascade({
        agentWhepUrl: WHEP,
        cloudDeviceId: null,
        transportMode: "lan-whep",
        videoEl: el,
        retryKey: 0,
        enabled: true,
      }),
    );
    await vi.waitFor(() => expect(result.current.state).toBe("connected"));
    expect(startStream).toHaveBeenCalledTimes(1);
    expect(stopStream).not.toHaveBeenCalled();

    unmount();
    expect(stopStream).toHaveBeenCalledTimes(1);
  });

  it("releases nothing when every transport failed", async () => {
    startStream.mockRejectedValue(new Error("WHEP 404"));
    const el = videoEl();
    const { result, unmount } = renderHook(() =>
      useVideoTransportCascade({
        agentWhepUrl: WHEP,
        cloudDeviceId: null,
        transportMode: "lan-whep",
        videoEl: el,
        retryKey: 0,
        enabled: true,
      }),
    );
    await vi.waitFor(() => expect(result.current.state).toBe("failed"));
    unmount();
    // A failed attempt acquired nothing. Releasing on its way out is how a
    // dead LAN attempt used to close a working P2P session.
    expect(stopStream).not.toHaveBeenCalled();
  });
});
