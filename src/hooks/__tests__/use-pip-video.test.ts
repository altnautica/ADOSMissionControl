/**
 * The picture-in-picture player reconnects a dropped leg with backoff and
 * releases its server-side WHEP session on teardown.
 *
 * @license GPL-3.0-only
 */

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pipRetryDelayMs,
  resolveWhepResource,
  usePipVideo,
} from "@/hooks/use-pip-video";

const WHEP = "http://host:8889/ir/whep";
/** One ref for every render, as a component's `useRef` would give. */
const VIDEO_REF = { current: null };

/** Every peer connection the hook created, newest last. */
const peers: FakePeerConnection[] = [];

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGathererState = "complete";
  localDescription: { sdp: string } | null = null;
  ontrack: ((event: { streams: unknown[] }) => void) | null = null;
  private listeners = new Map<string, Array<() => void>>();

  constructor() {
    peers.push(this);
  }
  addTransceiver() {}
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  removeEventListener() {}
  async createOffer() {
    return { type: "offer", sdp: "offer" };
  }
  async setLocalDescription(desc: { sdp: string }) {
    this.localDescription = desc;
  }
  async setRemoteDescription() {
    this.ontrack?.({ streams: [{}] });
  }
  getReceivers() {
    return [];
  }
  close() {}
  /** Drive a connection-state change the way the browser would. */
  transition(state: RTCPeerConnectionState) {
    this.connectionState = state;
    for (const fn of this.listeners.get("connectionstatechange") ?? []) fn();
  }
}

const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
  if (init?.method === "DELETE") return new Response(null, { status: 200 });
  return new Response("answer", {
    status: 201,
    headers: { Location: "/ir/whep/session-1" },
  });
});

describe("usePipVideo", () => {
  beforeEach(() => {
    peers.length = 0;
    fetchMock.mockClear();
    vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const posts = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  const deletes = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");

  it("reports a dropped live leg as lost and reconnects", async () => {
    const { result } = renderHook(() => usePipVideo(WHEP, VIDEO_REF));
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(posts()).toHaveLength(1);

    act(() => peers[0].transition("failed"));
    expect(result.current.status).toBe("lost");

    // The first reconnect fires after the first backoff step and comes back live.
    await waitFor(() => expect(posts()).toHaveLength(2), { timeout: 2000 });
    await waitFor(() => expect(result.current.status).toBe("live"));
    // The dropped attempt released its session before the new one opened.
    expect(deletes()[0][0]).toBe("http://host:8889/ir/whep/session-1");
  });

  it("deletes its WHEP session on teardown", async () => {
    const { result, unmount } = renderHook(() => usePipVideo(WHEP, VIDEO_REF));
    await waitFor(() => expect(result.current.status).toBe("live"));
    unmount();
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0][0]).toBe("http://host:8889/ir/whep/session-1");
  });

  it("reports a leg that never came up as an error, without auto-retrying", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("", { status: 503 }));
    const { result } = renderHook(() => usePipVideo(WHEP, VIDEO_REF));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(posts()).toHaveLength(1);
  });
});

describe("PiP reconnect helpers", () => {
  it("doubles the backoff from one second and caps it", () => {
    expect(pipRetryDelayMs(0)).toBe(1000);
    expect(pipRetryDelayMs(1)).toBe(2000);
    expect(pipRetryDelayMs(3)).toBe(8000);
    expect(pipRetryDelayMs(10)).toBe(16_000);
  });

  it("resolves a relative Location against the POST url", () => {
    expect(resolveWhepResource("/ir/whep/abc", WHEP)).toBe("http://host:8889/ir/whep/abc");
    expect(resolveWhepResource("session/abc", WHEP)).toBe("http://host:8889/ir/session/abc");
    expect(resolveWhepResource("http://other:1/x", WHEP)).toBe("http://other:1/x");
  });
});
