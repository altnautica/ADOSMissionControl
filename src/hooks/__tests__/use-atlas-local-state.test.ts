/**
 * @license GPL-3.0-only
 *
 * Tests for the Atlas local-first state poll. Covers the active path (a
 * LAN-paired drone — the Live World tab only mounts this hook when the World
 * Model feature is on — polls its agent and feeds the atlas store, signed in or
 * not, local-first) and the inert guards (no LAN key, cloud-relay
 * device, 404).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const {
  authRef,
  cloudDeviceIdRef,
  nodesRef,
  liveRef,
  getRawStateImpl,
  setLiveSpy,
  clearSpy,
} = vi.hoisted(() => ({
    authRef: { value: false },
    cloudDeviceIdRef: { value: null as string | null },
    nodesRef: {
      value: [
        { deviceId: "drone-1", hostname: "http://drone-1.local:8080", apiKey: "key-abc" },
      ] as Array<{ deviceId: string; hostname: string; apiKey: string }>,
    },
    liveRef: { value: { state: null } as Record<string, unknown> },
    getRawStateImpl: {
      value: (async () => null) as (id: string) => Promise<unknown>,
    },
    setLiveSpy: { fn: vi.fn() },
    clearSpy: { fn: vi.fn() },
  }));

vi.mock("@/lib/agent/plugin-client", () => ({
  PluginAgentClient: class {
    constructor(
      public baseUrl: string,
      public apiKey: string,
    ) {}
    getRawState(id: string) {
      return getRawStateImpl.value(id);
    }
  },
}));
vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<typeof import("@/lib/utils")>()),
  isDemoMode: () => false,
}));
vi.mock("@/stores/auth-store", () => ({
  useAuthStore: (sel: (s: { isAuthenticated: boolean }) => unknown) =>
    sel({ isAuthenticated: authRef.value }),
}));
vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: { cloudDeviceId: string | null }) => unknown) =>
    sel({ cloudDeviceId: cloudDeviceIdRef.value }),
}));
vi.mock("@/stores/local-nodes-store", () => ({
  useLocalNodesStore: (sel: (s: { nodes: unknown[] }) => unknown) =>
    sel({ nodes: nodesRef.value }),
}));
vi.mock("@/stores/atlas-store", () => ({
  useAtlasStore: {
    getState: () => ({
      live: liveRef.value,
      setLive: setLiveSpy.fn,
      clear: clearSpy.fn,
    }),
  },
}));

import { useAtlasLocalState } from "@/hooks/use-atlas-local-state";

describe("useAtlasLocalState", () => {
  beforeEach(() => {
    authRef.value = false;
    cloudDeviceIdRef.value = null;
    nodesRef.value = [
      { deviceId: "drone-1", hostname: "http://drone-1.local:8080", apiKey: "key-abc" },
    ];
    liveRef.value = { state: null };
    setLiveSpy.fn = vi.fn();
    clearSpy.fn = vi.fn();
    getRawStateImpl.value = async () => ({
      state: "capturing",
      sessionId: "sess-1",
      cameraCount: 6,
      vioHealth: "good",
      keyframesIngested: 42,
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("polls the local agent and feeds the mapped slice into the atlas store", async () => {
    renderHook(() => useAtlasLocalState("drone-1"));
    await waitFor(() => expect(setLiveSpy.fn).toHaveBeenCalled());
    const live = setLiveSpy.fn.mock.calls[0][0];
    expect(live).toMatchObject({
      state: "capturing",
      sessionId: "sess-1",
      cameraCount: 6,
      vioHealth: "good",
      keyframesIngested: 42,
    });
  });

  it("still polls when signed in (local-first for a non-cloud-relay drone)", async () => {
    authRef.value = true;
    renderHook(() => useAtlasLocalState("drone-1"));
    await waitFor(() => expect(setLiveSpy.fn).toHaveBeenCalled());
  });

  it("is inert when no LAN key is held for the drone", async () => {
    nodesRef.value = [];
    renderHook(() => useAtlasLocalState("drone-1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(setLiveSpy.fn).not.toHaveBeenCalled();
  });

  it("is inert when no drone is selected", async () => {
    renderHook(() => useAtlasLocalState(null));
    await new Promise((r) => setTimeout(r, 20));
    expect(setLiveSpy.fn).not.toHaveBeenCalled();
  });

  it("is inert when this drone is the active cloud-relay device (no double-write)", async () => {
    cloudDeviceIdRef.value = "drone-1";
    renderHook(() => useAtlasLocalState("drone-1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(setLiveSpy.fn).not.toHaveBeenCalled();
  });

  it("skips a 404 (no fresh state) without writing the store", async () => {
    getRawStateImpl.value = async () => null;
    renderHook(() => useAtlasLocalState("drone-1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(setLiveSpy.fn).not.toHaveBeenCalled();
  });

  it("clears the store on drone switch (local-first) so B never shows A's slice", async () => {
    const { rerender } = renderHook((id: string) => useAtlasLocalState(id), {
      initialProps: "drone-1",
    });
    // Mount clears once for the initial drone.
    expect(clearSpy.fn).toHaveBeenCalledTimes(1);
    // Switching to a drone with no LAN key (404/idle) must clear, not bleed A.
    nodesRef.value = [];
    rerender("drone-2");
    expect(clearSpy.fn).toHaveBeenCalledTimes(2);
  });

  it("does NOT clear for the cloud-relay device (the bridge owns the clear)", async () => {
    cloudDeviceIdRef.value = "drone-1";
    renderHook(() => useAtlasLocalState("drone-1"));
    await new Promise((r) => setTimeout(r, 20));
    expect(clearSpy.fn).not.toHaveBeenCalled();
  });
});
