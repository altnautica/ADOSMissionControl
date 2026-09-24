/**
 * @license GPL-3.0-only
 *
 * A cloud status row older than the stale threshold proves nothing about the
 * agent now. CloudStatusBridge must not re-assert its video state or republish
 * its MAVLink URL from it: the video card would read LIVE and the cascade would
 * dial an agent that stopped answering. A fresh row still fans out normally.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";

const h = vi.hoisted(() => {
  // Persisted stores read localStorage at import time.
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
  return { row: null as Record<string, unknown> | null };
});

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useConvexAuth: () => ({ isAuthenticated: false, isLoading: false }),
}));
vi.mock("@/hooks/use-convex-available", () => ({ useConvexAvailable: () => true }));
vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: () => h.row,
}));

import { CloudStatusBridge } from "../CloudStatusBridge";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useVideoStore } from "@/stores/video-store";

const DEVICE = "dev-1";

function row(ageMs: number): Record<string, unknown> {
  return {
    deviceId: DEVICE,
    updatedAt: Date.now() - ageMs,
    version: "1.0.0",
    uptimeSeconds: 100,
    videoState: "running",
    videoWhepUrl: "/whep",
    lastIp: "192.168.1.50",
    mavlinkWsUrl: "ws://192.168.1.50:8765/",
  };
}

beforeEach(() => {
  useAgentConnectionStore.setState({ cloudDeviceId: DEVICE, cloudMode: true, mavlinkUrl: null });
  useVideoStore.getState().setAgentVideoStatus("running", "http://192.168.1.50:8080/whep");
});

afterEach(() => {
  cleanup();
  h.row = null;
});

describe("CloudStatusBridge stale row", () => {
  it("does not assert video or republish the MAVLink URL from a stale row", () => {
    h.row = row(50_000);
    render(createElement(CloudStatusBridge));

    expect(useVideoStore.getState().agentVideoState).toBe("unknown");
    expect(useVideoStore.getState().agentWhepUrl).toBeNull();
    expect(useAgentConnectionStore.getState().mavlinkUrl).toBeNull();
  });

  it("fans out video and the MAVLink URL from a fresh row", () => {
    h.row = row(1_000);
    render(createElement(CloudStatusBridge));

    expect(useVideoStore.getState().agentVideoState).toBe("running");
    expect(useAgentConnectionStore.getState().mavlinkUrl).toBe("ws://192.168.1.50:8765/");
  });
});
