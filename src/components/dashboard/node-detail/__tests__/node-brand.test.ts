/**
 * @module node-detail/node-brand.test
 * @description A bare flight controller has no companion agent, so its header
 * status must come from the GCS's own FC session and heartbeat, never from the
 * (always disconnected) agent connection.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));

import { useNodeBrand } from "../node-brand";
import { useDroneStore } from "@/stores/drone-store";
import { useClockStore } from "@/stores/clock-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";

const NOW = 1_700_000_000_000;

beforeEach(() => {
  useAgentConnectionStore.setState({ connected: false });
  // The clock reads the time when its first consumer subscribes, so pin it.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  useClockStore.setState({ now: NOW });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("useNodeBrand flight-controller status", () => {
  it("reads online for a live FC session with no agent", () => {
    useDroneStore.setState({ lastHeartbeat: NOW - 1_000 });
    const { result } = renderHook(() =>
      useNodeBrand({ profile: "flight-controller", title: "FC", fcConnected: true, nodeDeviceId: null }),
    );
    expect(result.current.statusLine).toBe("hero.online");
  });

  it("reads reconnecting when the session's heartbeat has gone silent", () => {
    useDroneStore.setState({ lastHeartbeat: NOW - 30_000 });
    const { result } = renderHook(() =>
      useNodeBrand({ profile: "flight-controller", title: "FC", fcConnected: true, nodeDeviceId: null }),
    );
    expect(result.current.statusLine).toBe("hero.reconnecting");
  });

  it("reads offline with no FC session", () => {
    useDroneStore.setState({ lastHeartbeat: NOW });
    const { result } = renderHook(() =>
      useNodeBrand({ profile: "flight-controller", title: "FC", fcConnected: false, nodeDeviceId: null }),
    );
    expect(result.current.statusLine).toBe("hero.offline");
  });
});
