/**
 * The shell's agent bridges: the signed-in cloud fleet reaches the pairing
 * store every fleet surface reads, and the cloud bridges that need a signed-in
 * Convex session are not mounted in a local-only build (where mounting them
 * threw and took the shell down).
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import React, { Suspense } from "react";

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
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
});

const env = vi.hoisted(() => ({
  convexAvailable: true,
  rendered: { status: 0, results: 0 },
  // listMyDrones rows, as cmdDrones.listMyDrones returns them.
  myDrones: [
    { _id: "row-1", userId: "u1", deviceId: "drone-7", name: "Survey 7", apiKey: "k7", pairedAt: 1, profile: "drone" },
  ] as unknown[],
}));

vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<{ default: React.ComponentType }>) => {
    const Lazy = React.lazy(loader);
    return (props: Record<string, unknown>) => (
      <Suspense fallback={null}>
        <Lazy {...props} />
      </Suspense>
    );
  },
}));
vi.mock("@/hooks/use-convex-available", () => ({ useConvexAvailable: () => env.convexAvailable }));
vi.mock("@/hooks/use-convex-skip-query", () => ({
  useConvexSkipQuery: (_q: unknown, opts?: { enabled?: boolean }) => (opts?.enabled ? env.myDrones : undefined),
}));
vi.mock("@/hooks/use-fleet-nodes", () => ({ useFleetNodes: () => [] }));
vi.mock("@/components/command/CommandFleetMqttBridge", () => ({ CommandFleetMqttBridge: () => null }));
vi.mock("@/components/command/MqttControlGrantBridge", () => ({ MqttControlGrantBridge: () => null }));
vi.mock("@/components/command/CommandFleetStatusBridge", () => ({ CommandFleetStatusBridge: () => null }));
vi.mock("@/components/command/CommandFleetLocalBridge", () => ({ CommandFleetLocalBridge: () => null }));
vi.mock("@/components/command/VisionDetectionsBridge", () => ({ VisionDetectionsBridge: () => null }));
vi.mock("@/components/command/MqttBridge", () => ({ MqttBridge: () => null }));
vi.mock("@/components/command/CloudStatusBridge", () => ({
  CloudStatusBridge: () => {
    env.rendered.status++;
    return null;
  },
}));
vi.mock("@/components/command/CloudCommandResultBridge", () => ({
  CloudCommandResultBridge: () => {
    env.rendered.results++;
    return null;
  },
}));

import { AgentBridges } from "@/components/command/AgentBridges";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAuthStore } from "@/stores/auth-store";
import { usePairingStore } from "@/stores/pairing-store";

beforeEach(() => {
  env.convexAvailable = true;
  env.rendered = { status: 0, results: 0 };
  usePairingStore.setState({ pairedDrones: [] });
  useAuthStore.setState({ isAuthenticated: true });
  useAgentConnectionStore.setState({ cloudMode: false });
});

afterEach(() => {
  useAuthStore.setState({ isAuthenticated: false });
});

describe("AgentBridges", () => {
  it("mirrors the signed-in cloud fleet into the pairing store, and clears it on sign-out", async () => {
    render(<AgentBridges />);
    await waitFor(() =>
      expect(usePairingStore.getState().pairedDrones.map((d) => d.deviceId)).toEqual(["drone-7"]),
    );

    act(() => useAuthStore.setState({ isAuthenticated: false }));
    await waitFor(() => expect(usePairingStore.getState().pairedDrones).toEqual([]));
  });

  it("does not mount the cloud bridges in a build with no cloud backend", async () => {
    env.convexAvailable = false;
    useAgentConnectionStore.setState({ cloudMode: true });
    render(<AgentBridges />);
    // Let any lazily-loaded bridge finish loading before asserting.
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(env.rendered).toEqual({ status: 0, results: 0 });
  });

  it("mounts them when the cloud backend is there", async () => {
    useAgentConnectionStore.setState({ cloudMode: true });
    render(<AgentBridges />);
    await waitFor(() => expect(env.rendered.status).toBeGreaterThan(0));
    expect(env.rendered.results).toBeGreaterThan(0);
  });
});
