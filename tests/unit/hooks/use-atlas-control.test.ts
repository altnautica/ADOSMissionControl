/**
 * Tests for `useAtlasControl`: the real-agent readiness poll + arming gate
 * (LAN-paired, World Model feature enabled for the node, cloud-disjoint), the
 * inert path when no LAN node is paired, and the demo path (no network, mock
 * readiness, lifecycle mutation).
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/stores/settings-store";
import { act, renderHook, waitFor } from "@testing-library/react";

// happy-dom's localStorage.setItem is not a function in this config, so the
// persist middleware in local-nodes-store (whose storage is captured at import)
// would throw on setState. Install a working in-memory localStorage BEFORE the
// store modules load (vi.hoisted runs before imports).
vi.hoisted(() => {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
});

import { useAtlasControl } from "@/hooks/use-atlas-control";
import { useAtlasReadinessStore } from "@/stores/atlas-readiness-store";
import { useNodeFeaturesStore } from "@/stores/node-features-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useClockStore } from "@/stores/clock-store";
import { coerceReadiness } from "@/lib/agent/atlas-control-client";
import type { LocalNode } from "@/stores/local-nodes-store";

function res(status: number, body: unknown): Response {
  return { status, json: async () => body } as unknown as Response;
}

function node(overrides: Partial<LocalNode> & { deviceId: string }): LocalNode {
  return {
    name: overrides.deviceId,
    hostname: "http://dev.local:8080",
    apiKey: "KEY",
    profile: "drone",
    pairedAt: 0,
    ...overrides,
  };
}

const CAPTURING_WIRE = {
  enabled: true,
  profile: "drone",
  capture_profile: "balanced",
  cameras_configured: 6,
  pose_source: "local_vio",
  service_running: true,
  capturing: true,
  state: "capturing",
  session_id: "atlas-1",
  camera_count: 6,
  keyframes: 5,
  ingest_rate_hz: 6,
};

beforeEach(() => {
  useAtlasReadinessStore.setState({ snapshots: {} });
  useClockStore.setState({ now: Date.now() });
  useLocalNodesStore.setState({ nodes: [] });
  useNodeFeaturesStore.setState({ enabled: {} });
  useAgentConnectionStore.setState({ cloudDeviceId: null });
  useSettingsStore.setState({ demoMode: false });
  vi.stubGlobal("location", {
    protocol: "http:",
    href: "http://x/",
    search: "",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  useSettingsStore.setState({ demoMode: false });
});

describe("useAtlasControl — real LAN agent", () => {
  it("arms and polls readiness for a LAN-paired drone", async () => {
    useLocalNodesStore.setState({ nodes: [node({ deviceId: "dev1" })] });
    // The World Model feature must be enabled for this node — the poll gates on
    // the per-node opt-in, not a global flag.
    useNodeFeaturesStore.setState({ enabled: { dev1: ["world-model"] } });
    const fetchMock = vi.fn().mockResolvedValue(res(200, CAPTURING_WIRE));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAtlasControl("node:dev1"));
    expect(result.current.reachable).toBe(true);
    expect(result.current.live).toBe(true);
    expect(result.current.deviceId).toBe("dev1");

    await waitFor(() =>
      expect(result.current.readiness?.capturing).toBe(true),
    );
    expect(fetchMock).toHaveBeenCalled();
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("http://dev.local:8080/api/atlas/readiness");
    expect(useAtlasReadinessStore.getState().isCapturing("dev1", Date.now())).toBe(true);
  });

  it("still reads the drone's own readiness when the feature is off here", async () => {
    // Capture was started from another GCS; this browser never enabled the
    // feature, and must not report the drone as off.
    useLocalNodesStore.setState({ nodes: [node({ deviceId: "dev1" })] });
    const fetchMock = vi.fn().mockResolvedValue(res(200, CAPTURING_WIRE));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAtlasControl("node:dev1"));
    expect(result.current.reachable).toBe(true);
    expect(result.current.live).toBe(false);
    await waitFor(() => expect(result.current.readiness?.capturing).toBe(true));
  });

  it("reports a node that stopped answering as offline, not as its last state", async () => {
    useLocalNodesStore.setState({ nodes: [node({ deviceId: "dev1" })] });
    useNodeFeaturesStore.setState({ enabled: { dev1: ["world-model"] } });
    // Its last answer said capturing, and that answer has expired.
    useAtlasReadinessStore.setState({
      snapshots: {
        dev1: { readiness: coerceReadiness(CAPTURING_WIRE)!, expiresAt: Date.now() - 1 },
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    const { result } = renderHook(() => useAtlasControl("node:dev1"));
    expect(result.current.readiness).toBeNull();
    expect(result.current.offline).toBe(true);
    expect(useAtlasReadinessStore.getState().isCapturing("dev1", Date.now())).toBe(false);
  });

  it("treats a config write whose service restart failed as refused", async () => {
    useLocalNodesStore.setState({ nodes: [node({ deviceId: "dev1" })] });
    const fetchMock = vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === "PUT"
          ? res(502, {
              status: "error",
              enabled: true,
              persisted: true,
              restart: { status: "error", message: "Restart timed out for ados-atlas" },
            })
          : res(200, { ...CAPTURING_WIRE, capturing: false, state: "idle", service_running: false }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAtlasControl("node:dev1"));
    let landed = true;
    await act(async () => {
      landed = await result.current.enable();
    });
    expect(landed).toBe(false);
    expect(result.current.configError).toBe("Restart timed out for ados-atlas");
  });

  it("is inert (no poll) when no LAN node is paired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAtlasControl("node:dev1"));
    expect(result.current.live).toBe(false);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stands down for the active cloud-relay device (disjoint from cloud)", async () => {
    useLocalNodesStore.setState({ nodes: [node({ deviceId: "dev1" })] });
    useAgentConnectionStore.setState({ cloudDeviceId: "dev1" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useAtlasControl("node:dev1"));
    expect(result.current.live).toBe(false);
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled();
    useAgentConnectionStore.setState({ cloudDeviceId: null });
  });
});

describe("useAtlasControl — demo mode", () => {
  it("seeds a mock readiness and drives the lifecycle without the network", async () => {
    useSettingsStore.setState({ demoMode: true });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useAtlasControl("node:demo1"));
    expect(result.current.demo).toBe(true);
    expect(result.current.live).toBe(false);

    await waitFor(() => expect(result.current.readiness).not.toBeNull());
    // Starts disabled (service off), cameras present.
    expect(result.current.readiness?.enabled).toBe(false);
    expect(result.current.readiness?.camerasConfigured).toBe(6);

    await act(async () => {
      await result.current.enable();
    });
    expect(result.current.readiness?.enabled).toBe(true);

    await act(async () => {
      const r = await result.current.start();
      expect(r.ok).toBe(true);
    });
    expect(result.current.readiness?.capturing).toBe(true);
    expect(useAtlasReadinessStore.getState().isCapturing("demo1", Date.now())).toBe(true);

    await act(async () => {
      await result.current.pause();
    });
    expect(result.current.readiness?.state).toBe("paused");

    await act(async () => {
      await result.current.stop();
    });
    expect(result.current.readiness?.capturing).toBe(false);
    expect(useAtlasReadinessStore.getState().isCapturing("demo1", Date.now())).toBe(false);

    // No network touched throughout the demo lifecycle.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
